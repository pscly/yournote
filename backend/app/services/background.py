from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
from sqlalchemy import select

from .. import database
from ..models import Account, PublishDiaryRun, PublishDiaryRunItem
from ..utils.errors import safe_str
from .collector import CollectorService
from .publisher import DiaryPublisherService

logger = logging.getLogger(__name__)

# 运行中的发布任务（进程内防重）。注意：进程重启后不会保留。
_publish_run_tasks: dict[int, asyncio.Task] = {}


def _retry_suffix(exc: BaseException) -> str:
    attempts = getattr(exc, "yournote_attempts", None)
    try:
        attempts_i = int(attempts)
    except Exception:
        attempts_i = 0
    return f"（已重试 {attempts_i} 次）" if attempts_i > 1 else ""


def _parse_int_list_json(value: str | None) -> list[int]:
    if not isinstance(value, str) or not value.strip():
        return []
    try:
        data = json.loads(value)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    ids: list[int] = []
    for item in data:
        if isinstance(item, int):
            ids.append(item)
        elif isinstance(item, str) and item.isdigit():
            ids.append(int(item))
    return ids


async def _publish_one_account_in_background(*, run_id: int, account_id: int, force: bool) -> None:
    async with database.AsyncSessionLocal() as session:
        run_result = await session.execute(select(PublishDiaryRun).where(PublishDiaryRun.id == run_id))
        run = run_result.scalar_one_or_none()
        if not run:
            return

        account_result = await session.execute(
            select(Account).where(Account.is_active.is_(True), Account.id == account_id)
        )
        account = account_result.scalar_one_or_none()

        item_result = await session.execute(
            select(PublishDiaryRunItem)
            .where(PublishDiaryRunItem.run_id == run_id, PublishDiaryRunItem.account_id == account_id)
            .order_by(PublishDiaryRunItem.id.desc())
        )
        item = item_result.scalars().first()
        if not item:
            # 兜底：理论上 create_run 已经创建了 items；这里避免数据不一致导致任务中断。
            item = PublishDiaryRunItem(
                run_id=run_id,
                account_id=account_id,
                nideriji_userid=getattr(account, "nideriji_userid", 0) or 0,
                status="unknown",
            )
            session.add(item)
            await session.flush()

        # 已成功的不重复发布（除非 force=true）
        if not force and (item.status or "") == "success":
            return

        if not account:
            item.status = "failed"
            item.error_message = "账号不可用或已被禁用"
            item.nideriji_diary_id = None
            item.response_json = None
            await session.commit()
            return

        # 先标记为 running 并提交，让前端能实时看到进度
        item.status = "running"
        item.error_message = None
        item.nideriji_diary_id = None
        item.response_json = None
        await session.commit()

        collector = CollectorService(session)
        publisher = DiaryPublisherService(collector)
        date = (run.date or "").strip()
        content = run.content if isinstance(run.content, str) else ""

        try:
            resp_json: dict[str, Any] = await publisher.write_diary_for_account(
                account=account,
                date=date,
                content=content,
            )
            diary_data = resp_json.get("diary") if isinstance(resp_json, dict) else None
            nideriji_diary_id = None
            if isinstance(diary_data, dict):
                raw_id = diary_data.get("id")
                if isinstance(raw_id, (int, str)):
                    nideriji_diary_id = str(raw_id)
            item.status = "success"
            item.nideriji_diary_id = nideriji_diary_id
            item.error_message = None
            item.response_json = json.dumps(resp_json, ensure_ascii=False)
        except httpx.HTTPStatusError as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            item.status = "failed"
            item.error_message = (
                f"HTTPError: {safe_str(e, max_len=400)}"
                + (f" (HTTP {status_code})" if isinstance(status_code, int) else "")
            )
        except httpx.TimeoutException as e:
            item.status = "failed"
            item.error_message = f"发布超时（上游无响应{_retry_suffix(e)}）"
        except httpx.RequestError as e:
            item.status = "failed"
            item.error_message = f"网络异常{_retry_suffix(e)}: {safe_str(e, max_len=400)}"
        except Exception as e:
            item.status = "failed"
            item.error_message = f"发布异常: {safe_str(e, max_len=400)}"

        # 失败时保持 nideriji_diary_id/response_json 为 None，避免复用旧成功数据造成误读
        if (item.status or "") != "success":
            item.nideriji_diary_id = None
            item.response_json = None
        await session.commit()


async def _run_publish_run(*, run_id: int, concurrency: int, force: bool) -> None:
    # 先读取目标账号列表（避免在并发任务里重复查 run）
    async with database.AsyncSessionLocal() as session:
        run_result = await session.execute(select(PublishDiaryRun).where(PublishDiaryRun.id == run_id))
        run = run_result.scalar_one_or_none()
        if not run:
            return
        target_ids = _parse_int_list_json(run.target_account_ids_json)

    ids = [int(x) for x in target_ids if isinstance(x, int)]
    if not ids:
        return

    max_concurrency = max(1, min(int(concurrency or 1), 10, len(ids)))
    sem = asyncio.Semaphore(max_concurrency)

    async def _worker(aid: int) -> None:
        async with sem:
            await _publish_one_account_in_background(run_id=run_id, account_id=aid, force=force)

    await asyncio.gather(*[_worker(aid) for aid in ids])


async def schedule_publish_run(*, run_id: int, concurrency: int = 3, force: bool = False) -> dict[str, Any]:
    """启动后台发布任务（进程内防重）。"""
    existing = _publish_run_tasks.get(run_id)
    if existing and not existing.done():
        return {"scheduled": False, "already_running": True, "run_id": run_id, "concurrency": concurrency}

    task = asyncio.create_task(_run_publish_run(run_id=run_id, concurrency=concurrency, force=force))
    _publish_run_tasks[run_id] = task

    def _on_done(t: asyncio.Task) -> None:
        try:
            t.result()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("[PUBLISH] 后台发布任务异常：run_id=%s", run_id)
        finally:
            # 仅清理当前这次 task，避免并发 start 覆盖后误删
            if _publish_run_tasks.get(run_id) is t:
                _publish_run_tasks.pop(run_id, None)

    task.add_done_callback(_on_done)
    return {"scheduled": True, "already_running": False, "run_id": run_id, "concurrency": concurrency}


async def _run_account_sync(account_id: int) -> None:
    async with database.AsyncSessionLocal() as session:
        collector = CollectorService(session)
        try:
            await collector.sync_account(account_id)
        except Exception:
            # sync_account 内部会写入失败日志；这里吞掉异常避免后台任务把服务器日志刷爆。
            return


def schedule_account_sync(account_id: int) -> dict[str, Any]:
    """在后台触发一次账号同步（包含配对用户日记）。"""
    asyncio.create_task(_run_account_sync(account_id))
    return {"scheduled": True, "account_id": account_id}

"""发布/更新日记 API（面板专用）

设计目标：
- 提供“独立于采集日记(Diary)的写作空间”：草稿与发布历史单独存储。
- 一次发布可以选择多个账号（子账号），逐个发布并返回每个账号的结果。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Account, PublishDiaryDraft, PublishDiaryRun, PublishDiaryRunItem
from ..schemas import (
    PublishDiaryDraftResponse,
    PublishDiaryDraftUpsertRequest,
    PublishDiaryRequest,
    PublishDiaryRunListItemResponse,
    PublishDiaryRunResponse,
)
from ..services import CollectorService, DiaryPublisherService

router = APIRouter(prefix="/publish-diaries", tags=["publish-diaries"])


def _ensure_date_yyyy_mm_dd(value: str) -> str:
    text = (value or "").strip()
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"date 格式必须为 YYYY-MM-DD：{e}") from e
    return text


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


@router.get("/draft/{date}", response_model=PublishDiaryDraftResponse)
async def get_draft(date: str, db: AsyncSession = Depends(get_db)):
    """获取某天的草稿；不存在时返回空草稿。"""
    date = _ensure_date_yyyy_mm_dd(date)
    result = await db.execute(select(PublishDiaryDraft).where(PublishDiaryDraft.date == date))
    draft = result.scalar_one_or_none()

    if not draft:
        return PublishDiaryDraftResponse(date=date, content="", updated_at=None)

    updated_at = draft.updated_at
    if updated_at and updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return PublishDiaryDraftResponse(date=draft.date, content=draft.content or "", updated_at=updated_at)


@router.put("/draft/{date}", response_model=PublishDiaryDraftResponse)
async def upsert_draft(date: str, body: PublishDiaryDraftUpsertRequest, db: AsyncSession = Depends(get_db)):
    """保存/更新某天草稿。"""
    date = _ensure_date_yyyy_mm_dd(date)
    content = body.content if isinstance(body.content, str) else ""

    result = await db.execute(select(PublishDiaryDraft).where(PublishDiaryDraft.date == date))
    draft = result.scalar_one_or_none()
    if not draft:
        draft = PublishDiaryDraft(date=date, content=content)
        db.add(draft)
        await db.flush()
    else:
        draft.content = content
        await db.flush()

    await db.commit()
    await db.refresh(draft)

    updated_at = draft.updated_at
    if updated_at and updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return PublishDiaryDraftResponse(date=draft.date, content=draft.content or "", updated_at=updated_at)


@router.get("/runs", response_model=list[PublishDiaryRunListItemResponse])
async def list_runs(
    date: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """发布历史列表（可按 date 过滤）。"""
    if isinstance(date, str) and date.strip():
        date = _ensure_date_yyyy_mm_dd(date)
    else:
        date = None

    query = select(PublishDiaryRun).order_by(PublishDiaryRun.id.desc()).limit(limit).offset(offset)
    if date:
        query = query.where(PublishDiaryRun.date == date)

    result = await db.execute(query)
    runs = result.scalars().all()
    run_ids = [r.id for r in runs if r and isinstance(r.id, int)]
    items_by_run: dict[int, list[PublishDiaryRunItem]] = {}
    if run_ids:
        items_result = await db.execute(
            select(PublishDiaryRunItem).where(PublishDiaryRunItem.run_id.in_(run_ids))
        )
        for item in items_result.scalars().all():
            items_by_run.setdefault(item.run_id, []).append(item)

    response: list[PublishDiaryRunListItemResponse] = []
    for r in runs:
        created_at = r.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        items = items_by_run.get(r.id, [])
        success_count = sum(1 for i in items if (i.status or "") == "success")
        failed_count = sum(1 for i in items if (i.status or "") == "failed")
        response.append(
            PublishDiaryRunListItemResponse(
                id=r.id,
                date=r.date,
                target_account_ids=_parse_int_list_json(r.target_account_ids_json),
                created_at=created_at,
                success_count=success_count,
                failed_count=failed_count,
            )
        )
    return response


@router.get("/runs/{run_id}", response_model=PublishDiaryRunResponse)
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """查看一次发布的详情（含每个账号结果）。"""
    result = await db.execute(select(PublishDiaryRun).where(PublishDiaryRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    items_result = await db.execute(
        select(PublishDiaryRunItem).where(PublishDiaryRunItem.run_id == run_id).order_by(PublishDiaryRunItem.id.asc())
    )
    items = items_result.scalars().all()

    created_at = run.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    return PublishDiaryRunResponse(
        id=run.id,
        date=run.date,
        content=run.content or "",
        target_account_ids=_parse_int_list_json(run.target_account_ids_json),
        created_at=created_at,
        items=[
            {
                "account_id": i.account_id,
                "nideriji_userid": i.nideriji_userid,
                "status": i.status or "unknown",
                "nideriji_diary_id": i.nideriji_diary_id,
                "error_message": i.error_message,
            }
            for i in items
        ],
    )


@router.post("/publish", response_model=PublishDiaryRunResponse)
async def publish(body: PublishDiaryRequest, db: AsyncSession = Depends(get_db)):
    """发布/更新指定日期的日记到多个账号。"""
    date = _ensure_date_yyyy_mm_dd(body.date)
    content = body.content if isinstance(body.content, str) else ""

    # account_ids 为空时默认“全部活跃账号”
    account_ids = [int(x) for x in (body.account_ids or []) if isinstance(x, int)]
    if not account_ids:
        result = await db.execute(select(Account).where(Account.is_active == True))
        accounts = result.scalars().all()
    else:
        result = await db.execute(
            select(Account).where(Account.is_active == True, Account.id.in_(account_ids))
        )
        accounts = result.scalars().all()

    if not accounts:
        raise HTTPException(status_code=400, detail="未找到可用账号（请先添加账号，或勾选需要发布的账号）")

    # 保存草稿（可关闭）
    if body.save_draft:
        draft_result = await db.execute(select(PublishDiaryDraft).where(PublishDiaryDraft.date == date))
        draft = draft_result.scalar_one_or_none()
        if not draft:
            draft = PublishDiaryDraft(date=date, content=content)
            db.add(draft)
        else:
            draft.content = content

    run = PublishDiaryRun(
        date=date,
        content=content,
        target_account_ids_json=json.dumps([a.id for a in accounts], ensure_ascii=False),
    )
    db.add(run)
    await db.flush()

    collector = CollectorService(db)
    publisher = DiaryPublisherService(collector)

    items: list[PublishDiaryRunItem] = []
    for account in accounts:
        item = PublishDiaryRunItem(
            run_id=run.id,
            account_id=account.id,
            nideriji_userid=account.nideriji_userid,
            status="unknown",
        )
        db.add(item)
        items.append(item)
        await db.flush()

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
        except requests.HTTPError as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            item.status = "failed"
            item.error_message = (
                f"HTTPError: {e}"
                + (f" (HTTP {status_code})" if isinstance(status_code, int) else "")
            )
        except Exception as e:
            item.status = "failed"
            item.error_message = f"发布异常: {e}"

    await db.commit()
    await db.refresh(run)

    created_at = run.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    # 重新查询 items（确保 id/状态落库）
    items_result = await db.execute(
        select(PublishDiaryRunItem).where(PublishDiaryRunItem.run_id == run.id).order_by(PublishDiaryRunItem.id.asc())
    )
    items_db = items_result.scalars().all()

    return PublishDiaryRunResponse(
        id=run.id,
        date=run.date,
        content=run.content or "",
        target_account_ids=_parse_int_list_json(run.target_account_ids_json),
        created_at=created_at,
        items=[
            {
                "account_id": i.account_id,
                "nideriji_userid": i.nideriji_userid,
                "status": i.status or "unknown",
                "nideriji_diary_id": i.nideriji_diary_id,
                "error_message": i.error_message,
            }
            for i in items_db
        ],
    )


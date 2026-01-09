from __future__ import annotations

import asyncio
from typing import Any

from ..database import AsyncSessionLocal
from .collector import CollectorService


async def _run_account_sync(account_id: int) -> None:
    async with AsyncSessionLocal() as session:
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


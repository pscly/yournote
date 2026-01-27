"""Data synchronization API"""
from datetime import timezone
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import SyncLog
from ..schemas import SyncResponse
from ..services import CollectorService
from ..utils.errors import safe_str

router = APIRouter(prefix="/sync", tags=["sync"])
logger = logging.getLogger(__name__)


@router.post("/trigger/{account_id}")
async def trigger_sync(
    account_id: int,
    db: AsyncSession = Depends(get_db)
):
    """手动触发账号数据同步"""
    collector = CollectorService(db)
    try:
        result = await collector.sync_account(account_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_str(e)) from e
    except Exception as e:
        logger.exception("[SYNC] Trigger failed account_id=%s", account_id)
        raise HTTPException(status_code=500, detail="Sync failed") from e


@router.get("/logs", response_model=list[SyncResponse])
async def get_sync_logs(
    account_id: int | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """获取同步历史记录"""
    query = select(SyncLog).order_by(SyncLog.sync_time.desc()).limit(limit)
    if account_id is not None:
        query = query.where(SyncLog.account_id == account_id)

    result = await db.execute(query)
    logs = result.scalars().all()

    # SQLite 默认返回 naive datetime（通常代表 UTC 的 CURRENT_TIMESTAMP），这里补齐时区信息。
    # 统一成 UTC，交给前端按北京时间展示。
    for log in logs:
        if log.sync_time and log.sync_time.tzinfo is None:
            log.sync_time = log.sync_time.replace(tzinfo=timezone.utc)
    return logs


@router.get("/logs/latest", response_model=list[SyncResponse])
async def get_latest_sync_logs(
    account_id: int | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """获取每个账号“最新一条”同步日志（用于前端同步指示器，减少轮询数据量）。

    说明：
    - 与 `/sync/logs` 不同：这里的 `limit` 代表“最多返回多少个账号的最新记录”，
      而不是“返回多少条历史记录”。
    - 查询实现使用窗口函数 row_number()，兼容 PostgreSQL / SQLite。
    """
    rn = func.row_number().over(
        partition_by=SyncLog.account_id,
        order_by=SyncLog.sync_time.desc(),
    ).label("rn")

    base = select(SyncLog.id.label("id"), rn)
    if account_id is not None:
        base = base.where(SyncLog.account_id == account_id)

    subq = base.subquery()
    query = (
        select(SyncLog)
        .join(subq, SyncLog.id == subq.c.id)
        .where(subq.c.rn == 1)
        .order_by(SyncLog.sync_time.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    logs = result.scalars().all()

    for log in logs:
        if log.sync_time and log.sync_time.tzinfo is None:
            log.sync_time = log.sync_time.replace(tzinfo=timezone.utc)
    return logs

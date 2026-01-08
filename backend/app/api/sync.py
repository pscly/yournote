"""Data synchronization API"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Account, SyncLog
from ..schemas import SyncResponse
from ..services import CollectorService

router = APIRouter(prefix="/sync", tags=["sync"])


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
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.get("/logs", response_model=list[SyncResponse])
async def get_sync_logs(
    account_id: int | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """获取同步历史记录"""
    query = select(SyncLog).order_by(SyncLog.sync_time.desc()).limit(limit)
    if account_id:
        query = query.where(SyncLog.account_id == account_id)

    result = await db.execute(query)
    logs = result.scalars().all()
    return logs

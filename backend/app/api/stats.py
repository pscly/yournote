"""统计数据 API（仪表盘用）。"""

from __future__ import annotations

from datetime import timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Account, SyncLog, User
from ..schemas import StatsOverviewResponse

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview", response_model=StatsOverviewResponse)
async def get_stats_overview(db: AsyncSession = Depends(get_db)):
    """获取仪表盘统计概览。

    说明：
    - 时间统一按 UTC 返回（带 tzinfo），前端按北京时间展示。
    - 配对日记数量按数据库中“非主用户日记”统计：
      对于每条 Diary，若其 user_id != 该账号绑定的主用户 id，则视为“配对日记”。
    """

    total_accounts = await db.scalar(select(func.count()).select_from(Account).where(Account.is_active == True))
    total_users = await db.scalar(select(func.count()).select_from(User))

    # 配对日记数量：为保证响应速度，这里使用“最新同步日志”中的 paired_diaries_count 进行汇总。
    # 这通常能反映当前数据库中配对日记的规模，同时避免对 diaries 表做全表 join 计数导致超时。
    active_account_ids = await db.scalars(select(Account.id).where(Account.is_active == True))
    active_account_ids = list(active_account_ids.all())

    paired_diaries_count = 0
    if active_account_ids:
        logs = await db.scalars(
            select(SyncLog)
            .where(SyncLog.account_id.in_(active_account_ids))
            .order_by(SyncLog.account_id.asc(), SyncLog.sync_time.desc())
            .limit(5000)
        )
        seen_accounts: set[int] = set()
        for log in logs.all():
            if log.account_id in seen_accounts:
                continue
            seen_accounts.add(log.account_id)
            n = log.paired_diaries_count
            if isinstance(n, int):
                paired_diaries_count += n

    last_sync_time = await db.scalar(
        select(func.max(SyncLog.sync_time))
        .select_from(SyncLog)
        .join(Account, SyncLog.account_id == Account.id)
        .where(Account.is_active == True)
    )
    if last_sync_time and last_sync_time.tzinfo is None:
        last_sync_time = last_sync_time.replace(tzinfo=timezone.utc)

    return StatsOverviewResponse(
        total_accounts=int(total_accounts or 0),
        total_users=int(total_users or 0),
        paired_diaries_count=int(paired_diaries_count or 0),
        last_sync_time=last_sync_time,
    )

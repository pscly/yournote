"""统计数据 API（仪表盘用）。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import engine, get_db
from ..models import Account, Diary, PairedRelationship, SyncLog, User
from ..schemas import StatsOverviewResponse, StatsPairedDiariesIncreaseResponse

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview", response_model=StatsOverviewResponse)
async def get_stats_overview(db: AsyncSession = Depends(get_db)):
    """获取仪表盘统计概览。

    说明：
    - 时间统一按 UTC 返回（带 tzinfo），前端按北京时间展示。
    - 配对日记数量按数据库中“非主用户日记”统计：
      对于每条 Diary，若其 user_id != 该账号绑定的主用户 id，则视为“配对日记”。
    """

    total_accounts = await db.scalar(
        select(func.count()).select_from(Account).where(Account.is_active.is_(True))
    )
    total_users = await db.scalar(select(func.count()).select_from(User))

    # 配对日记数量：为保证响应速度，这里使用“最新同步日志”中的 paired_diaries_count 进行汇总。
    # 注意：SyncLog 中的 diaries_count / paired_diaries_count 代表“当前总数”，不是“本次新增数”；
    # 这样二次/多次同步时也能稳定反映数据库规模，同时避免对 diaries 表做全表 join 计数导致超时。
    active_account_ids = await db.scalars(select(Account.id).where(Account.is_active.is_(True)))
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
        .where(Account.is_active.is_(True))
    )
    if last_sync_time and last_sync_time.tzinfo is None:
        last_sync_time = last_sync_time.replace(tzinfo=timezone.utc)

    return StatsOverviewResponse(
        total_accounts=int(total_accounts or 0),
        total_users=int(total_users or 0),
        paired_diaries_count=int(paired_diaries_count or 0),
        last_sync_time=last_sync_time,
    )


@router.get("/paired-diaries/increase", response_model=StatsPairedDiariesIncreaseResponse)
async def get_paired_diaries_increase(
    since_ms: int = Query(..., ge=1, description="统计起点（UTC 毫秒时间戳）"),
    until_ms: int | None = Query(None, ge=1, description="统计终点（UTC 毫秒时间戳，左闭右开，不传则不设上限）"),
    limit: int = Query(200, ge=1, le=1000, description="返回明细条数上限"),
    include_inactive: bool = Query(False, description="是否包含停用账号"),
    db: AsyncSession = Depends(get_db),
):
    """统计窗口内“新增配对记录”（按首次入库时间 created_at）。

    设计目标：
    - 解决“今天才解锁了以前的记录”的口径问题：只要是今天（窗口内）首次入库，就算新增；
    - 返回 count + 明细列表（按 created_at 倒序），便于前端展示抽屉列表；
    - 仅统计“配对用户”的记录：Diary.user_id == PairedRelationship.paired_user_id。
    """

    if until_ms is not None and until_ms <= since_ms:
        raise HTTPException(status_code=422, detail="until_ms must be greater than since_ms")

    since_dt_utc = datetime.fromtimestamp(since_ms / 1000, tz=timezone.utc)
    until_dt_utc = None
    if until_ms is not None:
        until_dt_utc = datetime.fromtimestamp(until_ms / 1000, tz=timezone.utc)

    # 兼容 SQLite：
    # - SQLite 不真正支持 tz-aware datetime；
    # - 项目里 SQLite 通常存储 naive datetime（代表 UTC 的 CURRENT_TIMESTAMP）。
    # 这里把 since_dt 也转成 naive，避免比较时出现字符串格式差异导致的“漏算/错算”。
    if engine.dialect.name == "sqlite":
        since_dt = since_dt_utc.replace(tzinfo=None)
        until_dt = until_dt_utc.replace(tzinfo=None) if until_dt_utc else None
    else:
        since_dt = since_dt_utc
        until_dt = until_dt_utc

    join_condition = (
        (Diary.account_id == PairedRelationship.account_id)
        & (Diary.user_id == PairedRelationship.paired_user_id)
    )

    base_filters = [
        PairedRelationship.is_active.is_(True),
        Diary.created_at.is_not(None),
        Diary.created_at >= since_dt,
    ]
    if until_dt is not None:
        base_filters.append(Diary.created_at < until_dt)

    count_query = (
        select(func.count(distinct(Diary.id)))
        .select_from(Diary)
        .join(PairedRelationship, join_condition)
        .where(*base_filters)
    )
    if not include_inactive:
        count_query = (
            count_query.join(Account, Diary.account_id == Account.id)
            .where(Account.is_active.is_(True))
        )
    total_count = await db.scalar(count_query)

    diary_query = (
        select(Diary)
        .join(PairedRelationship, join_condition)
        .where(*base_filters)
        .distinct()
        .order_by(Diary.created_at.desc())
        .limit(limit)
    )
    if not include_inactive:
        diary_query = (
            diary_query.join(Account, Diary.account_id == Account.id)
            .where(Account.is_active.is_(True))
        )
    diaries = await db.scalars(diary_query)
    diaries = list(diaries.all())

    user_ids = {d.user_id for d in diaries if d and isinstance(d.user_id, int)}
    authors: list[User] = []
    if user_ids:
        authors = await db.scalars(select(User).where(User.id.in_(sorted(user_ids))))
        authors = list(authors.all())

    return StatsPairedDiariesIncreaseResponse(
        count=int(total_count or 0),
        diaries=diaries,
        authors=authors,
        since_time=since_dt_utc,
    )

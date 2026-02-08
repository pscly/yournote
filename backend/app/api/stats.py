"""统计数据 API（仪表盘用）。"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import engine, get_db
from ..models import Account, Diary, PairedRelationship, SyncLog, User
from ..schemas import (
    AccountResponse,
    DiaryListItemResponse,
    StatsDashboardLatestPairedDiariesResponse,
    StatsDashboardResponse,
    StatsOverviewResponse,
    StatsPairedDiariesIncreaseResponse,
    TokenStatus,
)
from ..utils.token import get_token_status

router = APIRouter(prefix="/stats", tags=["stats"])

_WS_RE = re.compile(r"\s+", flags=re.UNICODE)


def _count_no_whitespace(text: str | None) -> int:
    if not text:
        return 0
    return len(_WS_RE.sub("", str(text)))


def _build_preview(text: str | None, preview_len: int) -> str:
    if preview_len <= 0:
        return ""
    raw = "" if text is None else str(text)
    if len(raw) <= preview_len:
        return raw
    return raw[:preview_len] + "…"


def _build_account_response(
    account: Account,
    *,
    user_name: str | None,
    last_diary_ts: int | None,
) -> AccountResponse:
    return AccountResponse(
        id=account.id,
        nideriji_userid=account.nideriji_userid,
        user_name=user_name,
        email=account.email,
        is_active=bool(account.is_active),
        token_status=TokenStatus(**get_token_status(account.auth_token)),
        last_diary_ts=last_diary_ts,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _build_paired_relationship_exists_clause():
    """构造“记录属于有效配对关系”的 EXISTS 条件。"""
    return (
        select(1)
        .select_from(PairedRelationship)
        .where(
            PairedRelationship.account_id == Diary.account_id,
            PairedRelationship.paired_user_id == Diary.user_id,
            PairedRelationship.is_active.is_(True),
        )
        .exists()
    )


async def _get_latest_paired_diaries(
    *,
    db: AsyncSession,
    limit: int,
    preview_len: int,
) -> StatsDashboardLatestPairedDiariesResponse:
    started = time.perf_counter()
    matched_exists = _build_paired_relationship_exists_clause()

    # 说明：
    # - 使用 PairedRelationship.paired_user_id 作为“被匹配用户”，与现有统计口径保持一致；
    # - 只取 active 关系 + active 账号（仪表盘默认只展示启用账号的数据）。
    query = (
        select(Diary)
        .join(Account, Diary.account_id == Account.id)
        .where(
            matched_exists,
            Account.is_active.is_(True),
        )
        # 排序：优先按 ts（最后修改）倒序；ts 为空的放后面；再按 created_date/id 保底稳定排序
        .order_by(
            Diary.ts.is_(None).asc(),
            Diary.ts.desc(),
            Diary.created_date.desc(),
            Diary.id.desc(),
        )
        .limit(limit)
    )

    diaries = await db.scalars(query)
    diaries = list(diaries.all())

    items: list[DiaryListItemResponse] = []
    user_ids: set[int] = set()
    for d in diaries:
        if not d or d.id is None:
            continue
        if not isinstance(d.nideriji_diary_id, int):
            continue
        if not isinstance(d.user_id, int):
            continue
        if not isinstance(d.account_id, int):
            continue

        user_ids.add(d.user_id)
        items.append(
            DiaryListItemResponse(
                id=d.id,
                nideriji_diary_id=d.nideriji_diary_id,
                user_id=d.user_id,
                account_id=d.account_id,
                created_date=d.created_date,
                ts=d.ts,
                created_at=d.created_at,
                updated_at=d.updated_at,
                title=d.title,
                content_preview=_build_preview(d.content, preview_len),
                word_count_no_ws=_count_no_whitespace(d.content),
                weather=d.weather,
                mood=d.mood,
                space=d.space,
            )
        )

    authors: list[User] = []
    if user_ids:
        authors = await db.scalars(select(User).where(User.id.in_(sorted(user_ids))))
        authors = list(authors.all())

    took_ms = int((time.perf_counter() - started) * 1000)
    return StatsDashboardLatestPairedDiariesResponse(
        limit=int(limit),
        preview_len=int(preview_len),
        took_ms=took_ms,
        items=items,
        authors=authors,
    )


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

    matched_exists = _build_paired_relationship_exists_clause()

    base_filters = [
        Diary.created_at.is_not(None),
        Diary.created_at >= since_dt,
        matched_exists,
    ]
    if until_dt is not None:
        base_filters.append(Diary.created_at < until_dt)

    count_query = select(func.count()).select_from(Diary).where(*base_filters)
    if not include_inactive:
        count_query = (
            count_query.join(Account, Diary.account_id == Account.id)
            .where(Account.is_active.is_(True))
        )
    total_count = await db.scalar(count_query)

    diary_query = (
        select(Diary)
        .where(*base_filters)
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


@router.get("/dashboard", response_model=StatsDashboardResponse)
async def get_dashboard(
    latest_limit: int = Query(50, ge=1, le=200, description="最近配对记录返回条数上限"),
    latest_preview_len: int = Query(120, ge=0, le=1000, description="最近配对记录预览长度"),
    db: AsyncSession = Depends(get_db),
):
    """仪表盘聚合数据：账号 + 概览 + 最近配对记录。

    设计目标：
    - 降低仪表盘“跨账号聚合”的请求数（避免前端做 N+1）；
    - 默认只展示启用账号的数据（与 `/accounts` 口径一致）。
    """
    overview = await get_stats_overview(db)

    # 账号列表（含 token 状态与最近记录时间戳）
    result = await db.execute(select(Account).where(Account.is_active.is_(True)).order_by(Account.id.asc()))
    accounts = list(result.scalars().all())

    account_ids = [a.id for a in accounts if a and isinstance(a.id, int)]
    last_diary_ts_map: dict[int, int] = {}
    if account_ids:
        ts_result = await db.execute(
            select(Diary.account_id, func.max(Diary.ts))
            .where(Diary.account_id.in_(account_ids))
            .group_by(Diary.account_id)
        )
        last_diary_ts_map = {
            int(account_id): int(max_ts) for account_id, max_ts in ts_result.all() if max_ts is not None
        }

    nideriji_userids = [a.nideriji_userid for a in accounts if a and isinstance(a.nideriji_userid, int)]
    user_map: dict[int, User] = {}
    if nideriji_userids:
        users_result = await db.execute(select(User).where(User.nideriji_userid.in_(nideriji_userids)))
        user_map = {u.nideriji_userid: u for u in users_result.scalars().all() if u and u.nideriji_userid is not None}

    account_responses: list[AccountResponse] = []
    for a in accounts:
        if not a or a.id is None:
            continue
        user = user_map.get(a.nideriji_userid)
        account_responses.append(
            _build_account_response(
                a,
                user_name=(user.name if user else None),
                last_diary_ts=last_diary_ts_map.get(a.id),
            )
        )

    latest = await _get_latest_paired_diaries(db=db, limit=latest_limit, preview_len=latest_preview_len)

    return StatsDashboardResponse(
        overview=overview,
        accounts=account_responses,
        latest_paired_diaries=latest,
    )

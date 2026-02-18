"""User information API"""

from datetime import date, datetime, time, timedelta, timezone
from typing import cast
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Account, Diary, PairedRelationship, User
from ..schemas import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
async def list_users(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """获取所有用户列表"""
    result = await db.execute(select(User).limit(limit))
    users = result.scalars().all()
    return users


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    """获取用户详情"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{user_id}/last-login")
async def get_last_login_time(user_id: int, db: AsyncSession = Depends(get_db)):
    """获取用户最后登录时间（ISO 8601格式）"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    last_login_time = cast(datetime | None, cast(object, user.last_login_time))
    if last_login_time is not None:
        return {
            "user_id": user_id,
            "last_login_time": last_login_time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    return {"user_id": user_id, "last_login_time": None}


@router.get("/{user_id}/credentials")
async def get_user_credentials(user_id: int, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    account_result = await db.execute(
        select(Account).where(Account.nideriji_userid == user.nideriji_userid)
    )
    account = account_result.scalar_one_or_none()
    if not account:
        return {
            "has_account": False,
            "email": None,
            "can_view_password": False,
            "password_masked": None,
            "password": None,
        }

    # 仅当确实保存了密码时才返回遮罩（前端据此决定是否展示“显示/隐藏”切换）。
    password_obj = cast(object, account.login_password)
    password_raw: str | None = password_obj if isinstance(password_obj, str) else None
    password = password_raw if password_raw != "" else None
    password_masked = "******" if password is not None else None

    email_obj = cast(object, account.email)
    email: str | None = email_obj if isinstance(email_obj, str) else None
    return {
        "has_account": True,
        "email": email if email != "" else None,
        "can_view_password": True,
        "password_masked": password_masked,
        "password": password,
    }


@router.get("/paired/{account_id}")
async def get_paired_users(
    account_id: int, include_inactive: bool = False, db: AsyncSession = Depends(get_db)
):
    """获取账号的配对关系"""
    query = (
        select(PairedRelationship)
        .where(PairedRelationship.account_id == account_id)
        .order_by(PairedRelationship.id.asc())
    )
    if not include_inactive:
        query = query.where(PairedRelationship.is_active.is_(True))

    result = await db.execute(query)
    relationships = result.scalars().all()

    if not relationships:
        return []

    # 重要优化：避免 N+1 查询（原实现每条关系查 2 次 user 表）。
    user_ids = {
        uid
        for rel in relationships
        for uid in (rel.user_id, rel.paired_user_id)
        if isinstance(uid, int)
    }
    users_by_id: dict[int, User] = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_by_id = {
            int(cast(int, cast(object, u.id))): u
            for u in users_result.scalars().all()
            if u and u.id is not None
        }

    # 口径：created_time 优先；若缺失/不可靠则 fallback 到 created_date@北京时间 00:00。
    last_diary_by_user_id: dict[
        int, tuple[datetime | None, str | None, int | None]
    ] = {}
    if user_ids:
        user_id_list = list(user_ids)

        created_time_latest_by_user_id: dict[int, tuple[int, datetime]] = {}
        created_date_latest_by_user_id: dict[int, tuple[int, date]] = {}

        created_time_subq = (
            select(
                Diary.user_id.label("user_id"),
                Diary.id.label("diary_id"),
                Diary.created_time.label("created_time"),
                func.row_number()
                .over(
                    partition_by=Diary.user_id,
                    order_by=(Diary.created_time.desc(), Diary.id.desc()),
                )
                .label("rn"),
            )
            .where(
                Diary.account_id == account_id,
                Diary.user_id.in_(user_id_list),
                Diary.created_time.is_not(None),
            )
            .subquery()
        )
        created_time_rows = await db.execute(
            select(
                created_time_subq.c.user_id,
                created_time_subq.c.diary_id,
                created_time_subq.c.created_time,
            ).where(created_time_subq.c.rn == 1)
        )
        for uid, diary_id, created_time_value in created_time_rows.all():
            if not isinstance(uid, int) or not isinstance(diary_id, int):
                continue
            ct = cast(datetime | None, cast(object, created_time_value))
            if ct is None:
                continue
            created_time_latest_by_user_id[uid] = (diary_id, ct)

        created_date_subq = (
            select(
                Diary.user_id.label("user_id"),
                Diary.id.label("diary_id"),
                Diary.created_date.label("created_date"),
                func.row_number()
                .over(
                    partition_by=Diary.user_id,
                    order_by=(Diary.created_date.desc(), Diary.id.desc()),
                )
                .label("rn"),
            )
            .where(
                Diary.account_id == account_id,
                Diary.user_id.in_(user_id_list),
                Diary.created_date.is_not(None),
            )
            .subquery()
        )
        created_date_rows = await db.execute(
            select(
                created_date_subq.c.user_id,
                created_date_subq.c.diary_id,
                created_date_subq.c.created_date,
            ).where(created_date_subq.c.rn == 1)
        )
        for uid, diary_id, created_date_value in created_date_rows.all():
            if not isinstance(uid, int) or not isinstance(diary_id, int):
                continue
            cd = cast(date | None, cast(object, created_date_value))
            if cd is None:
                continue
            created_date_latest_by_user_id[uid] = (diary_id, cd)

        # ZoneInfo 依赖系统 tzdata；某些精简运行环境可能缺失。
        # 北京时间无夏令时，缺失时回退到固定 +08:00 也能保持口径一致。
        try:
            sh_tz = ZoneInfo("Asia/Shanghai")
        except Exception:
            sh_tz = timezone(timedelta(hours=8))

        for uid in user_id_list:
            ct_dt: datetime | None = None
            ct_diary_id: int | None = None
            if uid in created_time_latest_by_user_id:
                ct_diary_id, ct_raw = created_time_latest_by_user_id[uid]
                # SQLite 等场景可能返回 naive datetime；前端会把 naive 当 UTC，导致 8 小时偏差。
                ct_dt = ct_raw
                if ct_dt.tzinfo is None:
                    ct_dt = ct_dt.replace(tzinfo=timezone.utc)
                ct_dt = ct_dt.astimezone(timezone.utc)

            cd_dt: datetime | None = None
            cd_diary_id: int | None = None
            if uid in created_date_latest_by_user_id:
                cd_diary_id, cd_raw = created_date_latest_by_user_id[uid]
                # created_date 没有时区信息，按“北京时间当天 00:00:00”补齐，并转为 UTC 参与比较。
                cd_dt = datetime.combine(cd_raw, time.min, tzinfo=sh_tz).astimezone(
                    timezone.utc
                )

            effective_last: datetime | None
            source: str | None
            diary_id: int | None
            if ct_dt is None and cd_dt is None:
                effective_last, source, diary_id = None, None, None
            elif cd_dt is None or (ct_dt is not None and ct_dt >= cd_dt):
                effective_last, source, diary_id = ct_dt, "created_time", ct_diary_id
            else:
                effective_last, source, diary_id = cd_dt, "created_date", cd_diary_id

            last_diary_by_user_id[uid] = (effective_last, source, diary_id)

    paired_info: list[dict[str, object]] = []
    for rel in relationships:
        rel_user_id = int(cast(int, cast(object, rel.user_id)))
        rel_paired_user_id = int(cast(int, cast(object, rel.paired_user_id)))
        user = users_by_id.get(rel_user_id)
        paired_user = users_by_id.get(rel_paired_user_id)
        if not user or not paired_user:
            continue

        paired_time = cast(datetime | None, cast(object, rel.paired_time))
        if paired_time is not None and paired_time.tzinfo is None:
            paired_time = paired_time.replace(tzinfo=timezone.utc)

        paired_user_id = int(cast(int, cast(object, paired_user.id)))
        last_diary = last_diary_by_user_id.get(paired_user_id, (None, None, None))

        paired_info.append(
            {
                "id": rel.id,
                "account_id": rel.account_id,
                "is_active": bool(rel.is_active),
                "user": UserResponse.from_orm(user),
                "paired_user": UserResponse.from_orm(paired_user),
                "paired_time": paired_time,
                # 仅代表 paired_user（对方）的最后一次日记时间。
                "paired_user_last_diary_time": last_diary[0],
                "paired_user_last_diary_source": last_diary[1],
                "paired_user_last_diary_id": last_diary[2],
            }
        )

    return paired_info

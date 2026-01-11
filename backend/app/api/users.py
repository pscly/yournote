"""User information API"""
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import User, PairedRelationship
from ..schemas import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
async def list_users(
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """获取所有用户列表"""
    result = await db.execute(
        select(User).limit(limit)
    )
    users = result.scalars().all()
    return users


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取用户详情"""
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{user_id}/last-login")
async def get_last_login_time(
    user_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取用户最后登录时间（ISO 8601格式）"""
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.last_login_time:
        return {
            "user_id": user_id,
            "last_login_time": user.last_login_time.strftime("%Y-%m-%dT%H:%M:%S")
        }
    return {"user_id": user_id, "last_login_time": None}


@router.get("/paired/{account_id}")
async def get_paired_users(
    account_id: int,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db)
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
        users_by_id = {u.id: u for u in users_result.scalars().all() if u and u.id is not None}

    paired_info: list[dict] = []
    for rel in relationships:
        user = users_by_id.get(rel.user_id)
        paired_user = users_by_id.get(rel.paired_user_id)
        if not user or not paired_user:
            continue

        paired_time = rel.paired_time
        if paired_time and paired_time.tzinfo is None:
            paired_time = paired_time.replace(tzinfo=timezone.utc)

        paired_info.append(
            {
                "id": rel.id,
                "account_id": rel.account_id,
                "is_active": bool(rel.is_active),
                "user": UserResponse.from_orm(user),
                "paired_user": UserResponse.from_orm(paired_user),
                "paired_time": paired_time,
            }
        )

    return paired_info

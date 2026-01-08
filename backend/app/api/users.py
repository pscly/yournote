"""User information API"""
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
    db: AsyncSession = Depends(get_db)
):
    """获取账号的配对关系"""
    result = await db.execute(
        select(PairedRelationship)
        .where(PairedRelationship.account_id == account_id)
        .where(PairedRelationship.is_active == True)
    )
    relationships = result.scalars().all()

    paired_info = []
    for rel in relationships:
        user_result = await db.execute(
            select(User).where(User.id == rel.user_id)
        )
        paired_user_result = await db.execute(
            select(User).where(User.id == rel.paired_user_id)
        )

        user = user_result.scalar_one_or_none()
        paired_user = paired_user_result.scalar_one_or_none()

        if user and paired_user:
            paired_info.append({
                "user": UserResponse.from_orm(user),
                "paired_user": UserResponse.from_orm(paired_user),
                "paired_time": rel.paired_time
            })

    return paired_info

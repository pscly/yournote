"""Diary query API"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Diary, User
from ..schemas import DiaryResponse

router = APIRouter(prefix="/diaries", tags=["diaries"])


@router.get("", response_model=list[DiaryResponse])
async def list_diaries(
    account_id: int | None = None,
    user_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """获取日记列表（支持筛选）"""
    query = select(Diary).order_by(Diary.created_date.desc()).limit(limit).offset(offset)

    if account_id:
        query = query.where(Diary.account_id == account_id)
    if user_id:
        query = query.where(Diary.user_id == user_id)

    result = await db.execute(query)
    diaries = result.scalars().all()
    return diaries


@router.get("/{diary_id}", response_model=DiaryResponse)
async def get_diary(
    diary_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取单条日记详情"""
    result = await db.execute(
        select(Diary).where(Diary.id == diary_id)
    )
    diary = result.scalar_one_or_none()
    if not diary:
        raise HTTPException(status_code=404, detail="Diary not found")
    return diary


@router.get("/by-account/{account_id}", response_model=list[DiaryResponse])
async def get_diaries_by_account(
    account_id: int,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """按账号查询日记"""
    result = await db.execute(
        select(Diary)
        .where(Diary.account_id == account_id)
        .order_by(Diary.created_date.desc())
        .limit(limit)
    )
    diaries = result.scalars().all()
    return diaries

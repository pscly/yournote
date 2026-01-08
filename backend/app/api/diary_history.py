"""Diary history API"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import DiaryHistory
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/diary-history", tags=["diary-history"])


class DiaryHistoryResponse(BaseModel):
    id: int
    diary_id: int
    title: str | None
    content: str | None
    weather: str | None
    mood: str | None
    recorded_at: datetime

    class Config:
        from_attributes = True


@router.get("/{diary_id}", response_model=list[DiaryHistoryResponse])
async def get_diary_history(
    diary_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取日记的修改历史"""
    result = await db.execute(
        select(DiaryHistory)
        .where(DiaryHistory.diary_id == diary_id)
        .order_by(DiaryHistory.recorded_at.desc())
    )
    history = result.scalars().all()
    return history

from pydantic import BaseModel
from datetime import datetime, date


class DiaryResponse(BaseModel):
    """日记响应模型"""
    id: int
    nideriji_diary_id: int
    user_id: int
    account_id: int
    title: str | None
    content: str | None
    created_date: date
    created_time: datetime | None
    weather: str | None
    mood: str | None
    space: str | None
    ts: int | None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True

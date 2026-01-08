from pydantic import BaseModel
from datetime import datetime


class UserResponse(BaseModel):
    """用户响应模型"""
    id: int
    nideriji_userid: int
    name: str | None
    description: str | None
    role: str | None
    avatar: str | None
    diary_count: int
    word_count: int
    image_count: int
    last_login_time: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True

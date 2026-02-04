from pydantic import BaseModel, Field
from datetime import datetime, date


class DiaryImageAttachment(BaseModel):
    """记录图片附件信息（用于前端把 `[图13]` 映射成可访问的图片 URL）。"""

    image_id: int
    url: str
    cached: bool = False
    status: str | None = None


class DiaryAttachments(BaseModel):
    images: list[DiaryImageAttachment] = Field(default_factory=list)


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


class DiaryDetailResponse(DiaryResponse):
    """记录详情响应：在基础字段上附带附件信息。"""

    attachments: DiaryAttachments | None = None

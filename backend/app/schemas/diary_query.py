from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class DiaryListItemResponse(BaseModel):
    """记录列表项（用于搜索/筛选/分页场景）。

    设计目标：
    - 不返回完整 content，避免列表接口响应过大；
    - 返回可直接展示的预览与字数（去除空白后的字符数，贴近中文产品口径）。
    """

    id: int
    nideriji_diary_id: int
    user_id: int
    account_id: int

    created_date: date | None = None
    ts: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    title: str | None = None
    content_preview: str | None = None
    word_count_no_ws: int = 0

    weather: str | None = None
    mood: str | None = None
    space: str | None = None


class DiaryQueryResponse(BaseModel):
    """记录查询响应：count + items，支持前端分页。"""

    count: int = 0
    limit: int = 50
    offset: int = 0
    has_more: bool = False
    items: list[DiaryListItemResponse] = Field(default_factory=list)


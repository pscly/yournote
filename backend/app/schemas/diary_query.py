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
    msg_count: int = 0

    weather: str | None = None
    mood: str | None = None
    space: str | None = None


class DiaryQueryNormalized(BaseModel):
    """后端解析后的查询结构（用于前端展示与排障）。

    说明：
    - terms：普通关键词（按空格分词）
    - phrases：短语（双引号包裹）
    - excludes：排除词（以 '-' 开头）
    """

    mode: str = "and"  # and | or
    syntax: str = "smart"  # smart | plain
    terms: list[str] = Field(default_factory=list)
    phrases: list[str] = Field(default_factory=list)
    excludes: list[str] = Field(default_factory=list)


class DiaryQueryResponse(BaseModel):
    """记录查询响应：count + items，支持前端分页。"""

    count: int = 0
    limit: int = 50
    offset: int = 0
    has_more: bool = False
    # 后端处理耗时（ms）：包含 SQL 查询 + Python 组装 items 的开销
    took_ms: int = 0
    # 查询解析后的结构化信息，便于前端展示“当前在搜什么”
    normalized: DiaryQueryNormalized | None = None
    items: list[DiaryListItemResponse] = Field(default_factory=list)

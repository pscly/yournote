from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PublishDiaryDraftUpsertRequest(BaseModel):
    """保存/更新发布日记草稿请求"""

    content: str = Field(default="")


class PublishDiaryDraftResponse(BaseModel):
    """发布日记草稿响应"""

    date: str
    content: str
    updated_at: datetime | None = None


class PublishDiaryRunItemResponse(BaseModel):
    """发布结果（单账号）"""

    account_id: int
    nideriji_userid: int
    status: Literal["success", "failed", "unknown", "running"] = "unknown"
    nideriji_diary_id: str | None = None
    error_message: str | None = None


class PublishDiaryRunResponse(BaseModel):
    """发布记录（包含每个账号结果）"""

    id: int
    date: str
    content: str
    target_account_ids: list[int] = Field(default_factory=list)
    created_at: datetime | None = None
    items: list[PublishDiaryRunItemResponse] = Field(default_factory=list)


class PublishDiaryRunListItemResponse(BaseModel):
    """发布记录列表项（用于历史列表）"""

    id: int
    date: str
    target_account_ids: list[int] = Field(default_factory=list)
    created_at: datetime | None = None
    success_count: int = 0
    failed_count: int = 0


class PublishDiaryRequest(BaseModel):
    """点击“发布”的请求体"""

    date: str
    content: str
    account_ids: list[int] = Field(default_factory=list)
    save_draft: bool = True


class PublishDiaryPublishOneRequest(BaseModel):
    """单账号发布请求体（用于前端并行逐账号发布）。"""

    account_id: int


class PublishDiaryStartRunRequest(BaseModel):
    """启动一次发布 Run（后端后台异步执行）。"""

    concurrency: int = Field(default=3, ge=1, le=10)
    force: bool = False

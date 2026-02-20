from __future__ import annotations

from pydantic import BaseModel, Field


class DiaryBookmarkUpsertRequest(BaseModel):
    bookmarked: bool


class DiaryBookmarkBatchUpsertRequest(BaseModel):
    diary_ids: list[int] = Field(default_factory=list)
    bookmarked: bool


class DiaryBookmarkItemResponse(BaseModel):
    diary_id: int
    bookmarked_at: int | None = None


class DiaryBookmarkBatchResponse(BaseModel):
    updated: int = 0
    items: list[DiaryBookmarkItemResponse] = Field(default_factory=list)

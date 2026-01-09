from pydantic import BaseModel

from .diary import DiaryResponse


class DiaryRefreshInfo(BaseModel):
    """刷新日记详情的过程信息（用于前端展示与排错）"""

    min_len_threshold: int

    used_sync: bool
    sync_found: bool
    sync_content_len: int | None = None
    sync_is_simple: bool | None = None

    used_all_by_ids: bool
    all_by_ids_returned: bool | None = None
    detail_content_len: int | None = None
    detail_is_short: bool | None = None
    detail_attempts: int | None = None

    updated: bool
    update_source: str | None = None  # "sync" | "all_by_ids" | None
    skipped_reason: str | None = None


class DiaryRefreshResponse(BaseModel):
    """刷新日记接口响应：包含最新日记数据 + 刷新过程信息"""

    diary: DiaryResponse
    refresh_info: DiaryRefreshInfo


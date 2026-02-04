from datetime import datetime

from pydantic import BaseModel

from .diary import DiaryResponse
from .user import UserResponse


class StatsOverviewResponse(BaseModel):
    """仪表盘统计概览（主要用于前端展示）。"""

    total_accounts: int
    total_users: int
    paired_diaries_count: int
    last_sync_time: datetime | None = None


class StatsPairedDiariesIncreaseResponse(BaseModel):
    """仪表盘：配对记录的“新增（首次入库）”统计结果。"""

    count: int
    diaries: list[DiaryResponse]
    authors: list[UserResponse]
    since_time: datetime

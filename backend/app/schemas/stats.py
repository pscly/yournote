from datetime import datetime

from pydantic import BaseModel


class StatsOverviewResponse(BaseModel):
    """仪表盘统计概览（主要用于前端展示）。"""

    total_accounts: int
    total_users: int
    paired_diaries_count: int
    last_sync_time: datetime | None = None


from datetime import datetime

from pydantic import BaseModel, Field

from .account import AccountResponse
from .diary import DiaryResponse
from .diary_query import DiaryListItemResponse
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


class StatsDashboardLatestPairedDiariesResponse(BaseModel):
    """仪表盘：最近配对记录（跨账号聚合）。

    设计目标：
    - 避免前端做 N+1（每个账号先查配对关系再查记录列表），减少请求数与失败率；
    - 返回列表项（不含完整正文），保证仪表盘加载更快；
    - 同时返回 authors，用于前端把 user_id 映射成可读姓名。
    """

    limit: int = 50
    preview_len: int = 120
    took_ms: int = 0
    items: list[DiaryListItemResponse] = Field(default_factory=list)
    authors: list[UserResponse] = Field(default_factory=list)


class StatsDashboardResponse(BaseModel):
    """仪表盘聚合数据：用于一次请求拿到“账号 + 概览 + 最近配对记录”。

    注意：新增接口不替代现有 `/stats/overview`、`/accounts`、`/stats/paired-diaries/increase`，
    但前端仪表盘可优先使用该接口以减少请求数。
    """

    overview: StatsOverviewResponse
    accounts: list[AccountResponse] = Field(default_factory=list)
    latest_paired_diaries: StatsDashboardLatestPairedDiariesResponse | None = None

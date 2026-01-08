from pydantic import BaseModel
from datetime import datetime


class SyncResponse(BaseModel):
    """同步响应模型"""
    id: int
    account_id: int
    sync_time: datetime
    diaries_count: int | None
    paired_diaries_count: int | None
    status: str
    error_message: str | None

    class Config:
        from_attributes = True

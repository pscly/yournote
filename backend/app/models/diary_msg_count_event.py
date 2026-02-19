from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.sql import func

from ..database import Base


class DiaryMsgCountEvent(Base):
    """留言数增量事件表 - 记录 msg_count 变化，用于按时间窗口统计。"""

    __tablename__ = "diary_msg_count_events"
    __table_args__ = (
        Index(
            "idx_diary_msg_count_events_acc_diary_recorded_at",
            "account_id",
            "diary_id",
            "recorded_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)

    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    diary_id = Column(Integer, ForeignKey("diaries.id"), nullable=False, index=True)

    sync_log_id = Column(Integer, ForeignKey("sync_logs.id"), nullable=True, index=True)

    old_msg_count = Column(Integer, nullable=False)
    new_msg_count = Column(Integer, nullable=False)
    delta = Column(Integer, nullable=False)

    recorded_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    source = Column(String(20), nullable=False, default="sync", index=True)

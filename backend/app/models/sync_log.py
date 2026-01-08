from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class SyncLog(Base):
    """同步日志表 - 记录数据同步历史"""
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), index=True)
    sync_time = Column(DateTime(timezone=True), server_default=func.now())
    diaries_count = Column(Integer)
    paired_diaries_count = Column(Integer)
    status = Column(String(20))  # 'success', 'failed', 'partial'
    error_message = Column(Text)

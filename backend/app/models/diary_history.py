from sqlalchemy import Column, Integer, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class DiaryHistory(Base):
    """日记历史表 - 记录日记的修改历史"""
    __tablename__ = "diary_history"

    id = Column(Integer, primary_key=True, index=True)
    diary_id = Column(Integer, ForeignKey("diaries.id"), index=True)
    nideriji_diary_id = Column(Integer, index=True)
    title = Column(Text)
    content = Column(Text)
    weather = Column(Text)
    mood = Column(Text)
    ts = Column(Integer)  # 原始时间戳
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())

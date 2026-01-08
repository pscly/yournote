from sqlalchemy import Column, Integer, String, DateTime, Text, Date, BigInteger, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class Diary(Base):
    """日记表 - 存储日记内容"""
    __tablename__ = "diaries"

    id = Column(Integer, primary_key=True, index=True)
    nideriji_diary_id = Column(Integer, unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), index=True)
    title = Column(String(255))
    content = Column(Text)
    created_date = Column(Date, index=True)
    created_time = Column(DateTime(timezone=True))
    weather = Column(String(50))
    mood = Column(String(50))
    mood_id = Column(Integer)
    mood_color = Column(String(20))
    space = Column(String(10))  # 'boy' or 'girl'
    is_simple = Column(Integer, default=0)
    msg_count = Column(Integer, default=0)
    ts = Column(BigInteger)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

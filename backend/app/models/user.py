from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from ..database import Base


class User(Base):
    """用户信息表 - 存储用户基本信息"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    nideriji_userid = Column(Integer, unique=True, nullable=False, index=True)
    name = Column(String(100))
    description = Column(Text)
    role = Column(String(10))  # 'boy' or 'girl'
    avatar = Column(Text)
    diary_count = Column(Integer, default=0)
    word_count = Column(Integer, default=0)
    image_count = Column(Integer, default=0)
    last_login_time = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

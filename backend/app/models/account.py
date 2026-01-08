from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from ..database import Base


class Account(Base):
    """账号表 - 存储 nideriji 账号信息"""
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    nideriji_userid = Column(Integer, unique=True, nullable=False, index=True)
    auth_token = Column(Text, nullable=False)
    email = Column(String(255))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

from sqlalchemy import Column, Integer, DateTime, Boolean, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class PairedRelationship(Base):
    """配对关系表 - 存储账号与配对用户的关系"""
    __tablename__ = "paired_relationships"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    paired_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    paired_time = Column(DateTime(timezone=True))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

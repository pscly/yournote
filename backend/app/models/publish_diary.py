from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from ..database import Base


class PublishDiaryDraft(Base):
    """发布日记草稿表

    说明：
    - 该表用于“写/发布日记面板”的内容管理，和采集到的 Diary 表严格分离。
    - 以 date（YYYY-MM-DD）作为唯一键，方便快速切换日期并自动加载草稿。
    """

    __tablename__ = "publish_diary_drafts"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), unique=True, nullable=False, index=True)
    content = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PublishDiaryRun(Base):
    """发布日记记录（一次“点击发布”的整体记录）"""

    __tablename__ = "publish_diary_runs"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), nullable=False, index=True)
    content = Column(Text, nullable=False)
    target_account_ids_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PublishDiaryRunItem(Base):
    """发布日记记录项（每个账号一次结果）"""

    __tablename__ = "publish_diary_run_items"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("publish_diary_runs.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    nideriji_userid = Column(Integer, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="unknown")  # success | failed | unknown
    nideriji_diary_id = Column(String(32), nullable=True)
    error_message = Column(Text, nullable=True)
    response_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


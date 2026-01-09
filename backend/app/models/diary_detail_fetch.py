from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.sql import func

from ..database import Base


class DiaryDetailFetch(Base):
    """日记详情拉取状态表

    目的：
    - 记录某条日记是否已请求过详情接口（all_by_ids）
    - 若已请求过且返回内容仍 < 100 字，则后续同步时不再重复请求详情（除非手动强制刷新）
    """

    __tablename__ = "diary_detail_fetches"

    id = Column(Integer, primary_key=True, index=True)

    diary_id = Column(Integer, ForeignKey("diaries.id"), unique=True, index=True)
    nideriji_diary_id = Column(Integer, index=True)

    last_detail_at = Column(DateTime(timezone=True))
    last_detail_success = Column(Boolean, default=False)
    last_detail_is_short = Column(Boolean, default=False)
    last_detail_content_len = Column(Integer)
    last_detail_error = Column(Text)
    attempts = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


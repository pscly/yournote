from sqlalchemy import Column, DateTime, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from ..database import Base


class CachedImage(Base):
    """缓存图片表（从 nideriji 拉取并本地保存）。

    说明：
    - 正文中形如 `[图13]` 的占位符，对应 image_id=13。
    - 上游图片接口需要 nideriji_userid，因此这里把 (nideriji_userid, image_id) 作为唯一键。
    - data 存储原始二进制：SQLite=BLOB；PostgreSQL=BYTEA。
    """

    __tablename__ = "cached_images"
    __table_args__ = (
        UniqueConstraint("nideriji_userid", "image_id", name="uq_cached_images_user_image"),
        Index("idx_cached_images_user_image", "nideriji_userid", "image_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    nideriji_userid = Column(Integer, nullable=False, index=True)
    image_id = Column(Integer, nullable=False, index=True)

    content_type = Column(String(100))
    data = Column(LargeBinary)
    size_bytes = Column(Integer)
    sha256 = Column(String(64), index=True)

    # ok / forbidden / not_found / error
    fetch_status = Column(String(20), default="ok", index=True)
    error_message = Column(Text)
    fetched_at = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from .config import settings

# Create async engine (supports both SQLite and PostgreSQL)
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    future=True
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Base class for models
Base = declarative_base()


async def get_db():
    """Dependency for getting database session"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Initialize database tables"""
    # 确保所有模型都已被导入，从而注册到 Base.metadata
    # （否则单独运行 init_db.py 时可能出现“没有建表”的情况）
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_schema(conn)


async def _ensure_schema(conn) -> None:
    """做一层轻量 schema 兼容，避免本地 SQLite 升级后缺列导致报错。

    说明：
    - 本项目目前未引入 Alembic，因此对“新增字段”采用最小成本的自修复方式。
    - PostgreSQL 使用 IF NOT EXISTS；SQLite 通过 PRAGMA table_info 判断。
    """
    dialect = engine.dialect.name

    # 账号表：为“账号密码登录 / 自动刷新 token”保存密码
    if dialect == "sqlite":
        result = await conn.execute(text("PRAGMA table_info(accounts)"))
        cols = {row[1] for row in result.fetchall()}
        if "login_password" not in cols:
            await conn.execute(text("ALTER TABLE accounts ADD COLUMN login_password TEXT"))
    elif dialect.startswith("postgresql"):
        await conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS login_password TEXT"))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import event, text
from .config import settings

# 针对 SQLite 做一些“更像生产”的默认优化：
# - busy_timeout：降低并发写入下的 “database is locked”
# - WAL：提升并发读写能力（尤其是后台同步 + 前端查询并行）
# - foreign_keys：打开外键约束（SQLite 默认关闭）
_is_sqlite = str(settings.database_url or "").startswith("sqlite")
_connect_args = {"timeout": 30} if _is_sqlite else {}

# Create async engine (supports both SQLite and PostgreSQL)
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    future=True,
    connect_args=_connect_args,
)

# 只有 SQLite 才需要 PRAGMA；PostgreSQL 会忽略
if _is_sqlite:
    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA busy_timeout=30000;")
        cursor.close()

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

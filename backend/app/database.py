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
    echo=settings.sql_echo,
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

    # 索引：同步日志查询（按时间排序 / 按账号查最近一条）
    # 说明：
    # - 前端会轮询同步日志（同步指示器/刷新等待），没有索引时随着数据量增长会越来越慢
    # - IF NOT EXISTS 同时兼容 SQLite / PostgreSQL
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_time_desc ON sync_logs (sync_time DESC)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_sync_logs_account_time_desc ON sync_logs (account_id, sync_time DESC)")
    )

    # 记录列表/搜索：常用排序索引
    # 说明：
    # - `ts`：前端列表默认按“最近更新时间”排序
    # - `created_at`：用于“新增（按入库时间）”与历史统计等场景
    # - 使用 IF NOT EXISTS 同时兼容 SQLite / PostgreSQL
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_diaries_ts_desc ON diaries (ts DESC)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_diaries_created_at_desc ON diaries (created_at DESC)")
    )

    # 记录查询（筛选 + 日期范围 + 稳定排序）常用复合索引
    # 说明：
    # - PostgreSQL 可反向扫描索引，因此不强依赖 DESC；SQLite 也能从复合索引里获益
    # - 这些索引能显著加速 “账号/作者 + 日期范围 + 分页” 的常见查询
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_diaries_acc_date_id ON diaries (account_id, created_date, id)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_diaries_user_date_id ON diaries (user_id, created_date, id)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_diaries_date_id ON diaries (created_date, id)")
    )

    # 配对范围（scope=matched）会 join paired_relationships 并过滤 is_active
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_paired_relationships_acc_paired_active "
            "ON paired_relationships (account_id, paired_user_id, is_active)"
        )
    )

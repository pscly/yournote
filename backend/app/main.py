"""FastAPI application entry point"""
import asyncio
import logging
from pathlib import Path
import tomllib

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import settings
from .database import engine, init_db
from .api import (
    accounts_router,
    sync_router,
    diaries_router,
    users_router,
    diary_history_router,
    stats_router,
    access_router,
    access_logs_router,
    publish_diary_router,
)
from .scheduler import scheduler
from .middleware.access_gate import AccessGateMiddleware
from .utils.access_log import AccessLogTimer, log_http_request
from .utils.errors import exception_summary

logger = logging.getLogger(__name__)

# 默认降低 SQLAlchemy 的日志噪声：多数情况下是前端轮询导致的刷屏；排查 SQL 时再用 SQL_ECHO=true 打开
if not settings.sql_echo:
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)


def _read_app_version() -> str:
    """尽量从仓库根目录的 pyproject.toml 读取版本，避免多处硬编码导致不一致。"""
    try:
        repo_root = Path(__file__).resolve().parents[2]
        pyproject = repo_root / "pyproject.toml"
        if not pyproject.exists():
            return "0.2.0"
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        version = ((data.get("project") or {}).get("version") or "").strip()
        return version or "0.2.0"
    except Exception:
        return "0.2.0"


APP_VERSION = _read_app_version()

app = FastAPI(
    title="YourNote API",
    description="Diary collection system with multi-account support",
    version=APP_VERSION,
)

# CORS middleware
def _split_csv(value: str) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


cors_origins = _split_csv(settings.cors_allow_origins)
if not cors_origins or cors_origins == ["*"]:
    cors_origins = ["*"]
    cors_allow_credentials = False
else:
    cors_allow_credentials = bool(settings.cors_allow_credentials)

cors_methods = _split_csv(settings.cors_allow_methods)
if not cors_methods or cors_methods == ["*"]:
    cors_methods = ["*"]

cors_headers = _split_csv(settings.cors_allow_headers)
if not cors_headers or cors_headers == ["*"]:
    cors_headers = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_allow_credentials,
    allow_methods=cors_methods,
    allow_headers=cors_headers,
)

# 访问密码门禁（后端强制拦截点）
app.add_middleware(AccessGateMiddleware)

# Access log middleware（按天写入本地 logs/）
@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    timer = AccessLogTimer()
    status_code = 500
    error: str | None = None

    try:
        response = await call_next(request)
        status_code = getattr(response, "status_code", 200) or 200
        return response
    except Exception as e:
        # 访问日志里也尽量避免写入过多敏感/超长信息：保留异常类型用于定位即可。
        error = exception_summary(e, max_len=200 if settings.debug else 0)
        raise
    finally:
        # 访问日志不应影响业务逻辑；任何写日志异常都吞掉
        try:
            await log_http_request(
                request,
                status_code=status_code,
                duration_ms=timer.elapsed_ms(),
                error=error,
            )
        except Exception:
            logger.debug("[ACCESS_LOG] Failed to write access log", exc_info=True)

# Register API routers
app.include_router(accounts_router, prefix=settings.api_prefix)
app.include_router(sync_router, prefix=settings.api_prefix)
app.include_router(diaries_router, prefix=settings.api_prefix)
app.include_router(users_router, prefix=settings.api_prefix)
app.include_router(diary_history_router, prefix=settings.api_prefix)
app.include_router(stats_router, prefix=settings.api_prefix)
app.include_router(access_router, prefix=settings.api_prefix)
app.include_router(access_logs_router, prefix=settings.api_prefix)
app.include_router(publish_diary_router, prefix=settings.api_prefix)


@app.on_event("startup")
async def startup_event():
    """Initialize database and start scheduler on startup"""
    await init_db()

    def _log_task_result(task: asyncio.Task) -> None:
        try:
            task.result()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("[STARTUP] Initial sync task failed")

    # 启动时触发一次“全账号同步”（后台运行，不阻塞启动）
    if settings.sync_on_startup:
        logger.info("[STARTUP] Scheduling initial sync on startup...")
        task = asyncio.create_task(scheduler.sync_all_accounts())
        task.add_done_callback(_log_task_result)

    # 启动定时任务（按配置定期运行）
    scheduler.start()


@app.on_event("shutdown")
async def shutdown_event():
    """Stop scheduler on shutdown"""
    scheduler.shutdown()


@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "YourNote API", "version": APP_VERSION}


@app.get("/health")
async def health_check():
    """Health check endpoint（包含 DB 可用性探测）。"""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as e:
        logger.exception("[HEALTH] Database check failed: %s", exception_summary(e))
        raise HTTPException(status_code=503, detail="DB_UNAVAILABLE") from e

    return {"status": "healthy", "db": "ok"}

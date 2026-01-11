"""FastAPI application entry point"""
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import init_db
from .api import (
    accounts_router,
    sync_router,
    diaries_router,
    users_router,
    diary_history_router,
    stats_router,
    access_logs_router,
    publish_diary_router,
)
from .scheduler import scheduler
from .utils.access_log import AccessLogTimer, log_http_request

logger = logging.getLogger(__name__)

app = FastAPI(
    title="YourNote API",
    description="Diary collection system with multi-account support",
    version="0.1.0"
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
        error = str(e)
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
            pass

# Register API routers
app.include_router(accounts_router, prefix=settings.api_prefix)
app.include_router(sync_router, prefix=settings.api_prefix)
app.include_router(diaries_router, prefix=settings.api_prefix)
app.include_router(users_router, prefix=settings.api_prefix)
app.include_router(diary_history_router, prefix=settings.api_prefix)
app.include_router(stats_router, prefix=settings.api_prefix)
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
    return {"message": "YourNote API", "version": "0.1.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

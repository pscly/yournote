"""FastAPI application entry point"""
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

app = FastAPI(
    title="YourNote API",
    description="Diary collection system with multi-account support",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

    # 启动时运行一次同步
    print("[STARTUP] Running initial sync on startup...")
    await scheduler.sync_all_accounts()

    # 启动定时任务（每小时运行一次）
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

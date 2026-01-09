"""FastAPI application entry point"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import init_db
from .api import accounts_router, sync_router, diaries_router, users_router, diary_history_router
from .api import stats_router
from .scheduler import scheduler

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

# Register API routers
app.include_router(accounts_router, prefix=settings.api_prefix)
app.include_router(sync_router, prefix=settings.api_prefix)
app.include_router(diaries_router, prefix=settings.api_prefix)
app.include_router(users_router, prefix=settings.api_prefix)
app.include_router(diary_history_router, prefix=settings.api_prefix)
app.include_router(stats_router, prefix=settings.api_prefix)


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

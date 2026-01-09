from .accounts import router as accounts_router
from .sync import router as sync_router
from .diaries import router as diaries_router
from .users import router as users_router
from .diary_history import router as diary_history_router
from .stats import router as stats_router
from .access_logs import router as access_logs_router
from .publish_diary import router as publish_diary_router

__all__ = [
    "accounts_router",
    "sync_router",
    "diaries_router",
    "users_router",
    "diary_history_router",
    "stats_router",
    "access_logs_router",
    "publish_diary_router",
]

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_APP_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _APP_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent


def _load_root_dotenv() -> None:
    """
    统一从仓库根目录读取 `.env`（并保证其优先级最高）。

    说明：
    - 启动脚本通常会 `cd backend` / `cd frontend`，导致各自工具默认只会找子目录下的 `.env`。
    - 这里显式加载：先加载 `backend/.env`，再加载根目录 `.env`，并且 `override=True`，确保 `.env` 优先。
    """

    backend_env = _BACKEND_DIR / ".env"
    root_env = _REPO_ROOT / ".env"

    # 允许服务目录里放 `.env`，但最终以根目录 `.env` 为准（根目录后加载）。
    for env_file in (backend_env, root_env):
        if env_file.exists():
            load_dotenv(env_file, override=True, encoding="utf-8")


class Settings(BaseSettings):
    """Application settings"""

    # Server（供 run.py 使用）
    backend_host: str = "0.0.0.0"
    backend_port: int = 31012
    backend_reload: bool = True

    # Database
    # 优先使用 DATABASE_URL；不配置时再使用 SQLITE_DB_PATH 生成 sqlite URL
    database_url: str | None = None
    sqlite_db_path: str = "yournote.db"

    # API
    api_prefix: str = "/api"
    debug: bool = True

    # CORS
    # - 逗号分隔（例如：http://localhost:31011,http://127.0.0.1:31011）
    # - 默认 "*" 表示允许所有来源（此时会强制关闭 allow_credentials）
    cors_allow_origins: str = "*"
    cors_allow_credentials: bool = False
    cors_allow_methods: str = "*"
    cors_allow_headers: str = "*"

    # Access Log（本地访问日志，按天落盘）
    # - 文件：<repo>/logs/YYYY-MM-DD.logs
    # - 目的：方便直接在电脑上打开查看“谁在什么时候访问了什么”
    access_log_enabled: bool = True
    access_log_dir: str = "logs"
    # 逗号分隔：完全匹配 path（不含 query）时跳过记录（例如健康检查、pageview 上报接口）
    access_log_ignore_paths: str = "/health,/api/access-logs/pageview,/api/access-logs/file"
    # 是否记录 querystring（建议默认关闭，避免无意间写入敏感参数）
    access_log_include_query: bool = False

    # Startup
    # 是否在服务启动时自动触发一次“全账号同步”（异步后台执行，不阻塞启动）
    sync_on_startup: bool = True

    # Sync
    # - 优先使用分钟粒度，方便配置 20 分钟等场景
    # - 兼容旧配置：SYNC_INTERVAL_HOURS
    sync_interval_minutes: int | None = None
    sync_interval_hours: int | None = None

    @model_validator(mode="after")
    def _build_database_url_if_missing(self) -> "Settings":
        if self.database_url and self.database_url.strip():
            return self

        db_path = Path(self.sqlite_db_path)
        if not db_path.is_absolute():
            db_path = (_REPO_ROOT / db_path).resolve()

        # SQLAlchemy 在 Windows 下推荐使用形如：sqlite+aiosqlite:///C:/path/to/db 的写法
        self.database_url = f"sqlite+aiosqlite:///{db_path.as_posix()}"   
        return self

    @model_validator(mode="after")
    def _normalize_sync_interval(self) -> "Settings":
        minutes = self.sync_interval_minutes
        if minutes is None:
            if self.sync_interval_hours is not None:
                minutes = int(self.sync_interval_hours) * 60
            else:
                minutes = 20

        if minutes <= 0:
            minutes = 20

        self.sync_interval_minutes = minutes
        return self

    model_config = SettingsConfigDict(
        case_sensitive=False
    )


_load_root_dotenv()
settings = Settings()

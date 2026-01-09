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

    # Sync
    sync_interval_hours: int = 6

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

    model_config = SettingsConfigDict(
        case_sensitive=False
    )


_load_root_dotenv()
settings = Settings()

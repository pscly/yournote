from __future__ import annotations

import base64
import hashlib
from pathlib import Path

from dotenv import load_dotenv
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_APP_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _APP_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent


def _derive_access_session_secret_from_pwd(pwd: str) -> str:
    """从 PWD 派生 ACCESS_SESSION_SECRET（避免必须额外配置一个随机 secret）。

    说明：
    - 这是一个“便利默认值”，更适合本地工具；如果要部署到公网，建议显式配置一个高
      强度的 ACCESS_SESSION_SECRET。
    - 使用 PBKDF2 做一次派生，提升离线爆破成本（仍建议使用强密码）。
    """
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        pwd.encode("utf-8"),
        b"yournote_access_session_secret_v1",
        210_000,
        dklen=32,
    )
    return base64.urlsafe_b64encode(dk).decode("utf-8").rstrip("=")


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
    # 是否输出 SQLAlchemy 的 SQL 日志（`INFO sqlalchemy.engine.Engine ...`）
    # - 这是性能杀手之一：频繁输出会拖慢后端、并导致控制台刷屏
    # - 建议默认关闭；需要排查 SQL/事务时再临时打开
    sql_echo: bool = False

    # CORS
    # - 逗号分隔（例如：http://localhost:31011,http://127.0.0.1:31011）
    # - 默认 "*" 表示允许所有来源（此时会强制关闭 allow_credentials）
    cors_allow_origins: str = "*"
    cors_allow_credentials: bool = False
    cors_allow_methods: str = "*"
    cors_allow_headers: str = "*"

    # Access Gate（访问密码门禁）
    # - 默认：如果 .env 配置了 PWD，则自动启用（更贴合本地工具使用习惯）
    # - 也可显式用 ACCESS_ENABLED=true/false 控制
    access_enabled: bool | None = None
    # 兼容更直觉的开关名：ISPWD=true/false（是否需要访问密码）
    # - 当 ACCESS_ENABLED 未设置时，ISPWD 将作为开关生效
    ispwd: bool | None = None

    # 访问密码（二选一）：
    # 1) 推荐：ACCESS_PASSWORD_HASH=pbkdf2_sha256$...
    # 2) 兼容：PWD / ACCESS_PASSWORD_PLAINTEXT=明文密码
    #
    # 重要约定：前端登录时会先把用户输入做 sha256，再把 hex 字符串传给后端。
    # - 如果你使用 ACCESS_PASSWORD_HASH（PBKDF2），它对应的是“sha256(hex) 后再 PBKDF2”
    # - 如果你使用明文密码（PWD），后端会对明文做 sha256 后比对
    access_password_hash: str | None = None
    access_password_plaintext: str | None = None
    pwd: str | None = None  # 兼容旧配置：PWD=131

    # 会话 Cookie
    access_session_secret: str | None = None
    access_password_version: int = 1
    access_session_days: int = 90
    access_cookie_name: str = "yournote_access"
    access_cookie_samesite: str = "lax"  # lax | strict | none
    access_cookie_secure: str = "auto"  # auto | true | false

    # 逗号分隔：完全匹配 path（不含 query）时放行（默认会包含 /api/access/*）
    access_whitelist_paths: str | None = None

    # 防暴力破解：对 /api/access/login 做 IP 维度限流
    access_rate_limit_window_seconds: int = 300
    access_rate_limit_max_attempts: int = 20

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

    @model_validator(mode="after")
    def _normalize_access_gate(self) -> "Settings":
        plain = (self.access_password_plaintext or self.pwd or "").strip() or None
        configured_hash = (self.access_password_hash or "").strip() or None

        if self.access_enabled is None:
            # 开关优先级：
            # 1) ACCESS_ENABLED（显式）
            # 2) ISPWD（兼容：是否需要访问密码）
            # 3) 自动判断：配置了密码即启用
            if self.ispwd is not None:
                self.access_enabled = bool(self.ispwd)
            else:
                self.access_enabled = bool(configured_hash or plain)

        if not self.access_enabled:
            return self

        if not (configured_hash or plain):
            raise ValueError(
                "已启用访问门禁，但未配置访问密码（PWD / ACCESS_PASSWORD_PLAINTEXT / ACCESS_PASSWORD_HASH）"
            )

        secret = (self.access_session_secret or "").strip()
        if not secret:
            if plain:
                self.access_session_secret = _derive_access_session_secret_from_pwd(plain)
            else:
                raise ValueError("已启用访问门禁，但未配置 ACCESS_SESSION_SECRET，且无法从 PWD 派生")

        if int(self.access_session_days or 0) <= 0:
            self.access_session_days = 90

        if int(self.access_password_version or 0) <= 0:
            self.access_password_version = 1

        if not (self.access_cookie_name or "").strip():
            self.access_cookie_name = "yournote_access"

        samesite = (self.access_cookie_samesite or "lax").strip().lower()
        if samesite not in {"lax", "strict", "none"}:
            samesite = "lax"
        self.access_cookie_samesite = samesite

        secure = (self.access_cookie_secure or "auto").strip().lower()
        if secure not in {"auto", "true", "false"}:
            secure = "auto"
        self.access_cookie_secure = secure

        raw_whitelist = (self.access_whitelist_paths or "").strip()
        if not raw_whitelist:
            api_prefix = (self.api_prefix or "/api").rstrip("/") or "/api"
            self.access_whitelist_paths = ",".join(
                [
                    f"{api_prefix}/access/login",
                    f"{api_prefix}/access/logout",
                    f"{api_prefix}/access/status",
                    # 避免未授权状态下前端 pageview 上报触发跳转循环
                    f"{api_prefix}/access-logs/pageview",
                ]
            )

        return self

    model_config = SettingsConfigDict(
        case_sensitive=False
    )


_load_root_dotenv()
settings = Settings()

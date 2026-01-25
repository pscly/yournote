"""
PostgreSQL -> SQLite 数据迁移脚本

目标：
- 将现有 PostgreSQL（远程/本地）中的数据拷贝到 SQLite（用于本地开发）
- 迁移时自动在 SQLite 侧建表（基于当前 SQLAlchemy Model）
- 默认不会覆盖已存在的 SQLite 文件，避免误操作

使用方式（推荐从仓库根目录执行）：

1) 确保 `.env` 中已有 PostgreSQL 连接串（当前你正在用的那个即可）：
   DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>:5432/<db>

2) 运行迁移（默认写入到仓库根目录的 yournote.db）：
   cd backend
   uv run python migrate_postgres_to_sqlite.py --overwrite

可选参数：
- --source-url <url>  显式指定源 PostgreSQL 连接串（优先级最高）
- --target <path>     指定目标 SQLite 文件路径（默认：优先读取 SQLITE_DB_PATH，再回退到 ../yournote.db）
- --overwrite         若目标 SQLite 文件已存在，则先删除再迁移
- --batch <n>         批量写入大小（默认 1000）
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
from datetime import date, datetime, timezone
from getpass import getpass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Boolean, Date, DateTime, Select, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine


def _load_repo_dotenv() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True, encoding="utf-8")


def _mask_url(url: str) -> str:
    # 尽量避免在日志里泄露密码
    # 形如：postgresql+asyncpg://user:password@host:5432/db
    if "://" not in url or "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds_and_host = rest.split("@", 1)[0]
    if ":" not in creds_and_host:
        return f"{scheme}://{creds_and_host}@***"
    user = creds_and_host.split(":", 1)[0]
    return f"{scheme}://{user}:<redacted>@{rest.split('@', 1)[1]}"


def _redact_error_message(message: str) -> str:
    # 常见 SQLAlchemy/asyncpg 报错会把 DSN 打出来，做一次通用脱敏
    # 形如：postgresql+asyncpg://user:password@host:5432/db
    return re.sub(
        r"(postgresql\\+asyncpg://[^:/\\s]+):[^@/\\s]+@",
        r"\\1:<redacted>@",
        message,
    )


def _sqlite_url_from_path(path: Path) -> str:
    p = path.resolve()
    return f"sqlite+aiosqlite:///{p.as_posix()}"


def _resolve_target_sqlite_path(repo_root: Path, arg_target: str) -> Path:
    if arg_target:
        p = Path(arg_target).expanduser()
    else:
        raw = os.environ.get("SQLITE_DB_PATH", "").strip()
        p = Path(raw).expanduser() if raw else (repo_root / "yournote.db")

    if not p.is_absolute():
        p = (repo_root / p).resolve()
    return p


def _normalize_value_for_sqlite(column, value: Any) -> Any:
    if value is None:
        return None

    # Boolean：SQLite/SQLAlchemy 会用 0/1 表示；统一成 bool
    if isinstance(column.type, Boolean) and isinstance(value, int):
        return bool(value)

    # Postgres 通常返回 tz-aware datetime；SQLite 常用 naive（代表 UTC）更稳
    if isinstance(column.type, DateTime):
        if isinstance(value, datetime):
            if value.tzinfo is not None:
                return value.astimezone(timezone.utc).replace(tzinfo=None)
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace(" ", "T"))
            except ValueError:
                return value

    if isinstance(column.type, Date) and isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return value

    return value


async def _migrate_table(
    source: AsyncConnection,
    target: AsyncConnection,
    table,
    *,
    batch_size: int,
) -> int:
    stmt: Select = select(table)
    result = await source.execute(stmt)

    total = 0
    buffer: list[dict[str, Any]] = []

    for row in result.mappings():
        normalized: dict[str, Any] = {}
        for col in table.columns:
            normalized[col.name] = _normalize_value_for_sqlite(col, row.get(col.name))

        buffer.append(normalized)
        if batch_size > 0 and len(buffer) >= batch_size:
            await target.execute(table.insert(), buffer)
            total += len(buffer)
            buffer = []

    if buffer:
        await target.execute(table.insert(), buffer)
        total += len(buffer)

    return total


async def _ensure_sqlite_indexes(conn: AsyncConnection) -> None:
    # 与 backend/app/database.py::_ensure_schema 保持一致（SQLite 侧）
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_time_desc ON sync_logs (sync_time DESC)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_sync_logs_account_time_desc ON sync_logs (account_id, sync_time DESC)")
    )


def _normalize_postgres_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""

    # 常见写法兼容：postgres:// / postgresql:// -> postgresql+asyncpg://
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    return url


async def main() -> int:
    _load_repo_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", type=str, default="", help="源 PostgreSQL 连接串（默认读 .env 的 DATABASE_URL）")
    parser.add_argument("--target", type=str, default="", help="目标 SQLite 文件路径（默认读 SQLITE_DB_PATH 或 ../yournote.db）")
    parser.add_argument("--overwrite", action="store_true", help="若目标 SQLite 已存在则删除后重建")
    parser.add_argument("--batch", type=int, default=1000, help="批量写入大小（默认 1000）")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]

    source_url = _normalize_postgres_url(args.source_url or os.environ.get("DATABASE_URL", ""))
    if not source_url:
        print("[ERROR] 未检测到源 PostgreSQL 连接串")
        print("        请在仓库根目录 `.env` 设置 DATABASE_URL，或使用 --source-url 显式指定。")
        return 2

    if "<请填密码>" in source_url or "<password>" in source_url:
        user = source_url.split("://", 1)[1].split(":", 1)[0] if "://" in source_url and ":" in source_url else ""
        pwd = getpass(f"请输入 PostgreSQL 用户 {user or ''} 的密码（不会回显）：")
        source_url = source_url.replace("<请填密码>", pwd).replace("<password>", pwd)

    if not source_url.startswith("postgresql+asyncpg://"):
        print("[ERROR] 源连接串不是 postgresql+asyncpg:// 开头")
        print(f"        source={_mask_url(source_url)}")
        print("        你可以传入 postgresql:// 或 postgres://，脚本会自动转换。")
        return 2

    target_path = _resolve_target_sqlite_path(repo_root, args.target)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if target_path.exists():
        if not args.overwrite:
            print(f"[ERROR] 目标 SQLite 已存在：{target_path}")
            print("        为避免误覆盖，请加上 --overwrite，或换一个 --target 路径。")
            return 2
        target_path.unlink()

    target_url = _sqlite_url_from_path(target_path)

    print(f"[INFO] Source(Postgres): {_mask_url(source_url)}")
    print(f"[INFO] Target(SQLite): {target_path}")

    # 导入模型以确保 Base.metadata 已注册所有表
    # 注意：这些 import 会创建默认 engine 对象，但不会触发真实连接
    from app.database import Base  # noqa: WPS433
    from app import models  # noqa: F401,WPS433

    tables = list(Base.metadata.sorted_tables)
    if not tables:
        print("[ERROR] 未找到任何表定义（Base.metadata 为空）")
        return 2

    source_engine = create_async_engine(source_url, echo=False, future=True, pool_pre_ping=True)
    target_engine = create_async_engine(target_url, echo=False, future=True, connect_args={"timeout": 30})

    try:
        async with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
            # SQLite：迁移期间暂时关闭外键检查，避免插入顺序/循环依赖导致的中断
            await target_conn.execute(text("PRAGMA foreign_keys=OFF;"))

            # 先建表
            await target_conn.run_sync(Base.metadata.create_all)

            # 逐表迁移（按依赖顺序）
            for table in tables:
                count = await _migrate_table(source_conn, target_conn, table, batch_size=max(int(args.batch), 1))
                print(f"[INFO] {table.name}: {count} rows migrated")

            # 索引/补丁（与运行时保持一致）
            await _ensure_sqlite_indexes(target_conn)

            await target_conn.execute(text("PRAGMA foreign_keys=ON;"))

            # 最后做一次外键一致性检查（只在 SQLite）
            fk_issues = (await target_conn.execute(text("PRAGMA foreign_key_check;"))).fetchall()
            if fk_issues:
                print(f"[WARN] foreign_key_check returned {len(fk_issues)} issue(s).")
                print("       这通常意味着源库存在脏数据或 FK 依赖顺序/约束不一致。")

        print("[INFO] Migration completed.")
        return 0
    except Exception as e:
        msg = _redact_error_message(str(e))
        print(f"[ERROR] Migration failed: {msg}")
        return 1
    finally:
        await source_engine.dispose()
        await target_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))


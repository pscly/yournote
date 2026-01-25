"""
DB -> DB 数据迁移脚本（Adburl -> Bdburl）

目标：
- 在任意两个数据库 URL 之间拷贝数据（支持 SQLite / PostgreSQL）
- 迁移时自动在目标库建表（基于当前 SQLAlchemy Model）
- 支持一键清空目标库（避免重复迁移导致 UNIQUE 冲突）

使用方式（推荐从仓库根目录执行）：

1) 先在 `.env` 里准备好源/目标连接串（或在命令行传入）：
   - PostgreSQL: postgresql+asyncpg://user:password@host:5432/db
   - SQLite:      sqlite+aiosqlite:///C:/path/to/yournote.db

2) 运行迁移：
   cd backend
   uv run python migrate_db.py --source-url "<Adburl>" --target-url "<Bdburl>" --reset-target

为了更省事，你也可以用文件路径作为 SQLite 输入（会自动转成 sqlite+aiosqlite URL）：
   uv run python migrate_db.py --source ./yournote.db --target-url "<Bdburl>" --reset-target
   uv run python migrate_db.py --source-url "<Adburl>" --target ./yournote.db --reset-target

可选参数：
- --reset-target   迁移前清空目标库（Postgres: TRUNCATE ...; SQLite: DELETE FROM ...）
- --batch <n>      批量写入大小（默认 1000）
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
from sqlalchemy import Boolean, Date, DateTime, Integer, Select, select, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.exc import SQLAlchemyError
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


def _maybe_prompt_password(url: str) -> str:
    if "<请填密码>" not in url and "<password>" not in url:
        return url
    user = url.split("://", 1)[1].split(":", 1)[0] if "://" in url and ":" in url else ""
    pwd = getpass(f"请输入 PostgreSQL 用户 {user or ''} 的密码（不会回显）：")
    return url.replace("<请填密码>", pwd).replace("<password>", pwd)


def _normalize_db_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""

    # Postgres 常见写法兼容：postgres:// / postgresql:// / postgresql+psycopg2:// -> postgresql+asyncpg://
    for prefix in ("postgres://", "postgresql://", "postgresql+psycopg2://", "postgresql+psycopg://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]

    # SQLite 常见写法兼容：sqlite:/// -> sqlite+aiosqlite:///
    if url.startswith("sqlite:///"):
        return "sqlite+aiosqlite:///" + url[len("sqlite:///") :]
    if url.startswith("sqlite:///:memory:"):
        return "sqlite+aiosqlite:///:memory:"

    return url


def _sqlite_url_from_path(path: Path) -> str:
    p = path.resolve()
    return f"sqlite+aiosqlite:///{p.as_posix()}"


def _resolve_path(repo_root: Path, raw: str) -> Path:
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = (repo_root / p).resolve()
    return p


def _guess_url_or_path(repo_root: Path, raw_url: str, raw_path: str) -> str:
    if raw_url and raw_url.strip():
        return _normalize_db_url(raw_url)
    if raw_path and raw_path.strip():
        return _sqlite_url_from_path(_resolve_path(repo_root, raw_path))
    return ""


def _dialect_name(url: str) -> str:
    try:
        return make_url(url).get_backend_name()
    except Exception:
        return ""


def _is_sqlite(url: str) -> bool:
    return _dialect_name(url) == "sqlite"


def _is_postgres(url: str) -> bool:
    return _dialect_name(url) == "postgresql"


def _normalize_value(column, value: Any, *, target_is_sqlite: bool, target_is_postgres: bool) -> Any:
    if value is None:
        return None

    # SQLite 里 Boolean 常见为 0/1
    if isinstance(column.type, Boolean) and isinstance(value, int):
        return bool(value)

    if isinstance(column.type, Date) and isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return value

    if isinstance(column.type, DateTime):
        # 兼容 `YYYY-MM-DD HH:MM:SS` / `YYYY-MM-DDTHH:MM:SS`
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value.replace(" ", "T"))
            except ValueError:
                return value
            value = parsed

        if isinstance(value, datetime):
            # 目标是 SQLite：存成 naive（代表 UTC），更贴合本项目在 SQLite 下的行为
            if target_is_sqlite and value.tzinfo is not None:
                return value.astimezone(timezone.utc).replace(tzinfo=None)

            # 目标是 Postgres timestamptz：尽量用 tz-aware；naive 视为 UTC
            if target_is_postgres and value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)

    return value


async def _migrate_table(
    source: AsyncConnection,
    target: AsyncConnection,
    table,
    *,
    batch_size: int,
    target_is_sqlite: bool,
    target_is_postgres: bool,
) -> int:
    stmt: Select = select(table)
    result = await source.execute(stmt)

    total = 0
    buffer: list[dict[str, Any]] = []

    for row in result.mappings():
        normalized: dict[str, Any] = {}
        for col in table.columns:
            normalized[col.name] = _normalize_value(
                col,
                row.get(col.name),
                target_is_sqlite=target_is_sqlite,
                target_is_postgres=target_is_postgres,
            )

        buffer.append(normalized)
        if batch_size > 0 and len(buffer) >= batch_size:
            await target.execute(table.insert(), buffer)
            total += len(buffer)
            buffer = []

    if buffer:
        await target.execute(table.insert(), buffer)
        total += len(buffer)

    return total


async def _reset_target(conn: AsyncConnection, tables, *, target_is_sqlite: bool, target_is_postgres: bool) -> None:
    if target_is_postgres:
        table_names = [t.name for t in tables]
        if not table_names:
            return
        names_sql = ", ".join(f"\"{name}\"" for name in table_names)
        await conn.execute(text(f"TRUNCATE {names_sql} RESTART IDENTITY CASCADE"))
        return

    if target_is_sqlite:
        # SQLite：关闭外键检查后清空（避免因依赖顺序导致删除失败）
        await conn.execute(text("PRAGMA foreign_keys=OFF;"))
        for table in reversed(list(tables)):
            await conn.execute(text(f'DELETE FROM "{table.name}";'))
        await conn.execute(text("PRAGMA foreign_keys=ON;"))
        return

    raise ValueError("unsupported target dialect for reset")


async def _ensure_sqlite_indexes(conn: AsyncConnection) -> None:
    # 与 backend/app/database.py::_ensure_schema 保持一致（SQLite 侧）
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_time_desc ON sync_logs (sync_time DESC)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_sync_logs_account_time_desc ON sync_logs (account_id, sync_time DESC)")
    )


async def _fix_postgres_sequences(conn: AsyncConnection, tables) -> None:
    for table in tables:
        pk_cols = [c for c in table.columns if c.primary_key]
        if len(pk_cols) != 1:
            continue
        pk = pk_cols[0]
        if not isinstance(pk.type, Integer):
            continue

        seq_sql = text("SELECT pg_get_serial_sequence(:table_name, :col_name) AS seq")
        seq = (await conn.execute(seq_sql, {"table_name": table.name, "col_name": pk.name})).scalar_one_or_none()
        if not seq:
            continue

        max_id_sql = text(f'SELECT MAX("{pk.name}") FROM "{table.name}"')
        max_id = (await conn.execute(max_id_sql)).scalar_one_or_none()
        max_id_int = int(max_id or 0)

        # setval(<sequence>, <value>, true) 让下一次 nextval() 从 value+1 开始
        await conn.execute(text("SELECT setval(:seq, :value, true)"), {"seq": seq, "value": max_id_int})


async def main() -> int:
    _load_repo_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", type=str, default="", help="源数据库 URL（优先级最高）")
    parser.add_argument("--target-url", type=str, default="", help="目标数据库 URL（优先级最高）")
    parser.add_argument("--source", type=str, default="", help="源 SQLite 文件路径（会自动转为 sqlite+aiosqlite URL）")
    parser.add_argument("--target", type=str, default="", help="目标 SQLite 文件路径（会自动转为 sqlite+aiosqlite URL）")
    parser.add_argument("--reset-target", action="store_true", help="迁移前清空目标库（危险操作）")
    parser.add_argument("--batch", type=int, default=1000, help="批量写入大小（默认 1000）")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]

    source_url = _guess_url_or_path(repo_root, args.source_url, args.source)
    target_url = _guess_url_or_path(repo_root, args.target_url, args.target)

    if not source_url:
        source_url = _normalize_db_url(os.environ.get("DATABASE_URL", ""))
        source_url = source_url or _guess_url_or_path(repo_root, "", os.environ.get("SQLITE_DB_PATH", ""))

    if not target_url:
        target_url = _normalize_db_url(os.environ.get("TARGET_DATABASE_URL", ""))
        target_url = target_url or _guess_url_or_path(repo_root, "", os.environ.get("TARGET_SQLITE_DB_PATH", ""))

    if not source_url or not target_url:
        print("[ERROR] 缺少 source/target")
        print("        用法示例：")
        print('        uv run python migrate_db.py --source-url "<Adburl>" --target-url "<Bdburl>" --reset-target')
        print("        或：")
        print('        uv run python migrate_db.py --source ./yournote.db --target-url "<Bdburl>" --reset-target')
        return 2

    source_url = _maybe_prompt_password(source_url)
    target_url = _maybe_prompt_password(target_url)

    source_is_sqlite = _is_sqlite(source_url)
    source_is_postgres = _is_postgres(source_url)
    target_is_sqlite = _is_sqlite(target_url)
    target_is_postgres = _is_postgres(target_url)

    if not (source_is_sqlite or source_is_postgres):
        print("[ERROR] 不支持的 source 数据库类型")
        print(f"        source={source_url}")
        return 2
    if not (target_is_sqlite or target_is_postgres):
        print("[ERROR] 不支持的 target 数据库类型")
        print(f"        target={target_url}")
        return 2

    # 兼容：如果用户写了 postgresql:// 等，我们会转换为 asyncpg；否则 create_async_engine 会失败
    if source_is_postgres and not source_url.startswith("postgresql+asyncpg://"):
        source_url = _normalize_db_url(source_url)
    if target_is_postgres and not target_url.startswith("postgresql+asyncpg://"):
        target_url = _normalize_db_url(target_url)

    if target_url == source_url:
        print("[ERROR] source 与 target 相同，已中止（防止误覆盖）")
        return 2

    print(f"[INFO] Source: {_mask_url(source_url)}")
    print(f"[INFO] Target: {_mask_url(target_url)}")

    # 导入模型以确保 Base.metadata 已注册所有表
    # 注意：这些 import 会创建默认 engine 对象，但不会触发真实连接
    from app.database import Base  # noqa: WPS433
    from app import models  # noqa: F401,WPS433

    tables = list(Base.metadata.sorted_tables)
    if not tables:
        print("[ERROR] 未找到任何表定义（Base.metadata 为空）")
        return 2

    connect_args_target: dict[str, Any] = {}
    if target_is_sqlite:
        connect_args_target = {"timeout": 30}

    source_engine = create_async_engine(
        source_url,
        echo=False,
        future=True,
        pool_pre_ping=True,
        hide_parameters=True,
    )
    target_engine = create_async_engine(
        target_url,
        echo=False,
        future=True,
        pool_pre_ping=True,
        connect_args=connect_args_target,
        hide_parameters=True,
    )

    try:
        async with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
            if target_is_sqlite:
                # 对齐项目运行时行为（不强依赖；失败也无所谓）
                try:
                    await target_conn.execute(text("PRAGMA journal_mode=WAL;"))
                    await target_conn.execute(text("PRAGMA synchronous=NORMAL;"))
                    await target_conn.execute(text("PRAGMA busy_timeout=30000;"))
                except Exception:
                    pass

            # 先建表（若已存在则跳过）
            await target_conn.run_sync(Base.metadata.create_all)

            if args.reset_target:
                await _reset_target(
                    target_conn,
                    tables,
                    target_is_sqlite=target_is_sqlite,
                    target_is_postgres=target_is_postgres,
                )

            # SQLite：迁移期间临时关闭外键检查，避免插入顺序/循环依赖导致中断
            if target_is_sqlite:
                await target_conn.execute(text("PRAGMA foreign_keys=OFF;"))

            batch_size = max(int(args.batch), 1)
            for table in tables:
                count = await _migrate_table(
                    source_conn,
                    target_conn,
                    table,
                    batch_size=batch_size,
                    target_is_sqlite=target_is_sqlite,
                    target_is_postgres=target_is_postgres,
                )
                print(f"[INFO] {table.name}: {count} rows migrated")

            if target_is_sqlite:
                await _ensure_sqlite_indexes(target_conn)
                await target_conn.execute(text("PRAGMA foreign_keys=ON;"))
                fk_issues = (await target_conn.execute(text("PRAGMA foreign_key_check;"))).fetchall()
                if fk_issues:
                    print(f"[WARN] foreign_key_check returned {len(fk_issues)} issue(s).")
                    print("       这通常意味着源库存在脏数据或 FK 约束不一致。")

            if target_is_postgres:
                await _fix_postgres_sequences(target_conn, tables)

        print("[INFO] Migration completed.")
        return 0
    except Exception as e:
        # 避免将 SQLAlchemy 的报错参数（可能包含 token/密码等敏感字段）直接打印到控制台
        message = str(e)
        if isinstance(e, SQLAlchemyError) and getattr(e, "orig", None) is not None:
            message = str(e.orig)
        print(f"[ERROR] Migration failed: {_redact_error_message(message)}")
        return 1
    finally:
        await source_engine.dispose()
        await target_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

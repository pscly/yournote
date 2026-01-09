"""
SQLite -> PostgreSQL 数据迁移脚本

目标：
- 将现有 SQLite（默认仓库根目录 `yournote.db`）中的数据拷贝到 PostgreSQL
- 迁移时自动在 PostgreSQL 侧建表（基于当前 SQLAlchemy Model）
- 迁移后自动修复自增主键序列，避免后续插入冲突

使用方式（推荐从仓库根目录执行）：

1) 在根目录 `.env` 中配置好 `DATABASE_URL`（Postgres）：
   DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>:5432/<db>

2) 运行迁移：
   cd backend
   uv run python migrate_sqlite_to_postgres.py

可选参数：
- --source <path>  指定 SQLite 文件路径（默认优先找 `../.yournote.db`，再找 `../yournote.db`）
- --truncate       迁移前清空目标库的业务表（TRUNCATE ... CASCADE）
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import date, datetime
from getpass import getpass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Boolean, Date, DateTime, Integer, Select, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
import re


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


def _guess_source_sqlite_path(repo_root: Path) -> Path:
    candidates = [
        repo_root / ".yournote.db",
        repo_root / "yournote.db",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[-1]


def _sqlite_url_from_path(path: Path) -> str:
    p = path.resolve()
    return f"sqlite+aiosqlite:///{p.as_posix()}"


def _normalize_value(column, value: Any) -> Any:
    if value is None:
        return None

    # SQLite 里 Boolean 常见为 0/1
    if isinstance(column.type, Boolean) and isinstance(value, int):
        return bool(value)

    # SQLite 里 Date/DateTime 常见为 ISO 字符串
    if isinstance(column.type, Date) and isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return value

    if isinstance(column.type, DateTime) and isinstance(value, str):
        try:
            # 兼容 `YYYY-MM-DD HH:MM:SS` / `YYYY-MM-DDTHH:MM:SS`
            return datetime.fromisoformat(value.replace(" ", "T"))
        except ValueError:
            return value

    return value


async def _fetch_all_rows(source: AsyncConnection, table) -> list[dict[str, Any]]:
    stmt: Select = select(table)
    result = await source.execute(stmt)
    rows = []
    for row in result.mappings():
        normalized = {}
        for col in table.columns:
            normalized[col.name] = _normalize_value(col, row.get(col.name))
        rows.append(normalized)
    return rows


def _chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    if size <= 0:
        return [items]
    return [items[i : i + size] for i in range(0, len(items), size)]


async def _truncate_tables(conn: AsyncConnection, tables) -> None:
    # 只清理业务表，按 metadata.sorted_tables 顺序逆序 TRUNCATE（带 CASCADE）
    table_names = [t.name for t in tables]
    if not table_names:
        return
    names_sql = ", ".join(f'"{name}"' for name in table_names)
    await conn.execute(text(f"TRUNCATE {names_sql} RESTART IDENTITY CASCADE"))


async def _fix_sequences(conn: AsyncConnection, tables) -> None:
    # 插入显式 id 后，修复各表的序列到 max(id)
    for table in tables:
        pk_cols = [c for c in table.columns if c.primary_key]
        if len(pk_cols) != 1:
            continue
        pk = pk_cols[0]
        if not isinstance(pk.type, Integer):
            continue

        # pg_get_serial_sequence 只对 serial/identity 有返回；没返回就跳过
        seq_sql = text(
            """
            SELECT pg_get_serial_sequence(:table_name, :col_name) AS seq
            """
        )
        seq = (await conn.execute(seq_sql, {"table_name": table.name, "col_name": pk.name})).scalar_one()
        if not seq:
            continue

        # setval(seq, max(id), true)
        await conn.execute(
            text(
                f"""
                SELECT setval(:seq,
                              COALESCE((SELECT MAX("{pk.name}") FROM "{table.name}"), 1),
                              true)
                """
            ),
            {"seq": seq},
        )


async def main() -> int:
    _load_repo_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=str, default="", help="SQLite 文件路径（默认自动探测）")
    parser.add_argument("--truncate", action="store_true", help="迁移前清空目标库业务表")
    parser.add_argument("--batch", type=int, default=1000, help="批量写入大小（默认 1000）")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]

    source_path = Path(args.source).expanduser() if args.source else _guess_source_sqlite_path(repo_root)
    if not source_path.exists():
        print(f"[ERROR] 未找到 SQLite 文件：{source_path}")
        print("        请确认源库文件路径，或使用 `--source <path>` 指定。")
        return 2

    source_url = _sqlite_url_from_path(source_path)

    import os

    target_url = os.environ.get("DATABASE_URL", "").strip()
    if not target_url:
        print("[ERROR] 未检测到 DATABASE_URL（目标 PostgreSQL 连接串）")
        print("        请在仓库根目录 `.env` 中设置 DATABASE_URL 后再运行。")
        return 2

    if "<请填密码>" in target_url or "<password>" in target_url:
        # 给一个交互式补全密码的机会（不把密码写到日志）
        user = target_url.split("://", 1)[1].split(":", 1)[0] if "://" in target_url and ":" in target_url else ""
        pwd = getpass(f"请输入 PostgreSQL 用户 {user or ''} 的密码（不会回显）：")
        target_url = target_url.replace("<请填密码>", pwd).replace("<password>", pwd)

    if not target_url.startswith("postgresql+asyncpg://"):
        print("[ERROR] 目标 DATABASE_URL 不是 postgresql+asyncpg:// 开头，脚本只迁移到 PostgreSQL。")
        print(f"        DATABASE_URL={_mask_url(target_url)}")
        return 2

    print(f"[INFO] Source(SQLite): {source_path}")
    print(f"[INFO] Target(Postgres): {_mask_url(target_url)}")

    # 导入模型以确保 Base.metadata 已注册所有表
    # 注意：这些 import 会创建默认 engine 对象，但不会触发真实连接
    from app.database import Base  # noqa: WPS433
    from app import models  # noqa: F401,WPS433

    tables = list(Base.metadata.sorted_tables)
    if not tables:
        print("[ERROR] 未找到任何表定义（Base.metadata 为空）")
        return 2

    source_engine = create_async_engine(source_url, echo=False, future=True)
    target_engine = create_async_engine(target_url, echo=False, future=True)

    try:
        try:
            async with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
                # 先建表
                await target_conn.run_sync(Base.metadata.create_all)

                if args.truncate:
                    await _truncate_tables(target_conn, tables)

                # 逐表迁移（按依赖顺序）
                for table in tables:
                    rows = await _fetch_all_rows(source_conn, table)
                    if not rows:
                        print(f"[INFO] {table.name}: 0 rows (skip)")
                        continue

                    for chunk in _chunked(rows, args.batch):
                        await target_conn.execute(table.insert(), chunk)

                    print(f"[INFO] {table.name}: {len(rows)} rows migrated")

                await _fix_sequences(target_conn, tables)

            print("[DONE] 迁移完成。")
            return 0
        except Exception as e:  # noqa: BLE001
            msg = _redact_error_message(str(e))
            print(f"[ERROR] 迁移失败：{type(e).__name__}: {msg}")
            print("        常见原因：数据库不存在/权限不足/网络不可达/端口不通/密码错误。")
            return 1
    finally:
        await source_engine.dispose()
        await target_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

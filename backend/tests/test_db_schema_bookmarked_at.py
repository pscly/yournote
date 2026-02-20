from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import override
from unittest.mock import patch

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.database import _ensure_schema


class DBSchemaBookmarkedAtTests(unittest.IsolatedAsyncioTestCase):
    engine: AsyncEngine | None = None

    @override
    async def asyncSetUp(self):
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.engine = engine

        async with engine.begin() as conn:
            await conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY)"))
            await conn.execute(
                text(
                    "CREATE TABLE sync_logs ("
                    "id INTEGER PRIMARY KEY, "
                    "account_id INTEGER, "
                    "sync_time INTEGER"
                    ")"
                )
            )
            await conn.execute(
                text(
                    "CREATE TABLE paired_relationships ("
                    "id INTEGER PRIMARY KEY, "
                    "account_id INTEGER, "
                    "paired_user_id INTEGER, "
                    "is_active INTEGER"
                    ")"
                )
            )
            await conn.execute(
                text(
                    "CREATE TABLE diaries ("
                    "id INTEGER PRIMARY KEY, "
                    "account_id INTEGER, "
                    "user_id INTEGER, "
                    "ts INTEGER, "
                    "created_at TEXT, "
                    "created_date TEXT"
                    ")"
                )
            )

    @override
    async def asyncTearDown(self):
        if self.engine is not None:
            await self.engine.dispose()

    async def _get_diaries_cols(self) -> set[str]:
        assert self.engine is not None
        async with self.engine.connect() as conn:
            result = await conn.execute(text("PRAGMA table_info(diaries)"))
            return {row[1] for row in result.fetchall()}

    async def _get_diaries_indexes(self) -> set[str]:
        assert self.engine is not None
        async with self.engine.connect() as conn:
            result = await conn.execute(text("PRAGMA index_list(diaries)"))
            return {row[1] for row in result.fetchall()}

    async def test_ensure_schema_adds_bookmarked_at_and_is_idempotent(self):
        assert self.engine is not None
        with patch("backend.app.database.engine", self.engine):
            async with self.engine.begin() as conn:
                await _ensure_schema(conn)

            cols = await self._get_diaries_cols()
            self.assertIn("bookmarked_at", cols)

            indexes = await self._get_diaries_indexes()
            self.assertIn("idx_diaries_bookmarked_at_desc", indexes)

            async with self.engine.begin() as conn:
                await _ensure_schema(conn)


if __name__ == "__main__":
    unittest.main()

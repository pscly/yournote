"""回归测试：避免 PostgreSQL 下 DISTINCT + ORDER BY 表达式冲突。"""

from __future__ import annotations

import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# 让测试可直接导入 backend/app 包
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import diaries as diaries_api
from app.api import stats as stats_api
from app.database import Base
from app.models import Account, Diary, PairedRelationship, User


class _ScalarRows:
    def __init__(self, rows: list[object]):
        self._rows = rows

    def all(self) -> list[object]:
        return list(self._rows)


class _CaptureScalarsOnlyDB:
    def __init__(self):
        self.scalars_queries = []

    async def scalars(self, query):
        self.scalars_queries.append(query)
        return _ScalarRows([])


class _CaptureQueryDB:
    def __init__(self):
        self.scalar_queries = []
        self.scalars_queries = []

    async def scalar(self, query):
        self.scalar_queries.append(query)
        return 0

    async def scalars(self, query):
        self.scalars_queries.append(query)
        return _ScalarRows([])


class DistinctOrderByRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def _seed_duplicate_relationship_case(self) -> dict[str, int | datetime]:
        now = datetime.now(timezone.utc)

        async with self.session_factory() as session:
            owner = User(nideriji_userid=50101, name="主用户")
            paired = User(nideriji_userid=60101, name="配对用户")
            account = Account(
                nideriji_userid=50101,
                auth_token="token test",
                email="test@example.com",
                is_active=True,
            )
            session.add_all([owner, paired, account])
            await session.flush()

            session.add_all(
                [
                    PairedRelationship(
                        account_id=account.id,
                        user_id=owner.id,
                        paired_user_id=paired.id,
                        is_active=True,
                    ),
                    PairedRelationship(
                        account_id=account.id,
                        user_id=owner.id,
                        paired_user_id=paired.id,
                        is_active=True,
                    ),
                ]
            )

            diary = Diary(
                nideriji_diary_id=9100001,
                user_id=paired.id,
                account_id=account.id,
                title="测试记录",
                content="测试内容",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                ts=1700000000000,
            )
            session.add(diary)
            await session.commit()

            return {
                "account_id": int(account.id),
                "paired_user_id": int(paired.id),
                "created_at": now,
            }

    async def test_dashboard_latest_query_compiles_without_distinct(self):
        db = _CaptureScalarsOnlyDB()

        await stats_api._get_latest_paired_diaries(db=db, limit=50, preview_len=120)

        self.assertGreaterEqual(len(db.scalars_queries), 1)
        sql = str(db.scalars_queries[0].compile(dialect=postgresql.dialect()))
        sql_upper = sql.upper()

        self.assertNotIn("SELECT DISTINCT", sql_upper)
        self.assertIn("EXISTS", sql_upper)
        self.assertIn("ORDER BY", sql_upper)

    async def test_dashboard_latest_does_not_duplicate_rows(self):
        await self._seed_duplicate_relationship_case()

        async with self.session_factory() as session:
            result = await stats_api._get_latest_paired_diaries(db=session, limit=50, preview_len=120)

        self.assertEqual(len(result.items), 1)

    async def test_paired_increase_does_not_duplicate_count_or_rows(self):
        seeded = await self._seed_duplicate_relationship_case()
        since_ms = int((seeded["created_at"] - timedelta(hours=1)).replace(tzinfo=timezone.utc).timestamp() * 1000)

        async with self.session_factory() as session:
            with patch.object(stats_api, "engine", self.engine):
                result = await stats_api.get_paired_diaries_increase(
                    since_ms=since_ms,
                    until_ms=None,
                    limit=200,
                    include_inactive=False,
                    db=session,
                )

        self.assertEqual(result.count, 1)
        self.assertEqual(len(result.diaries), 1)

    async def test_diaries_query_uses_exists_and_no_distinct(self):
        db = _CaptureQueryDB()

        await diaries_api.query_diaries(
            q=None,
            q_mode="and",
            q_syntax="smart",
            scope="matched",
            account_id=None,
            user_id=None,
            date_from=None,
            date_to=None,
            include_inactive=True,
            include_stats=True,
            include_preview=True,
            limit=50,
            offset=0,
            order_by="ts",
            order="desc",
            preview_len=120,
            db=db,
        )

        self.assertEqual(len(db.scalar_queries), 1)
        self.assertEqual(len(db.scalars_queries), 1)

        count_sql = str(db.scalar_queries[0].compile(dialect=postgresql.dialect())).upper()
        items_sql = str(db.scalars_queries[0].compile(dialect=postgresql.dialect())).upper()

        self.assertNotIn("SELECT DISTINCT", count_sql)
        self.assertNotIn("SELECT DISTINCT", items_sql)
        self.assertIn("EXISTS", count_sql)
        self.assertIn("EXISTS", items_sql)

    async def test_diaries_query_scope_matched_does_not_duplicate_rows(self):
        await self._seed_duplicate_relationship_case()

        async with self.session_factory() as session:
            result = await diaries_api.query_diaries(
                q=None,
                q_mode="and",
                q_syntax="smart",
                scope="matched",
                account_id=None,
                user_id=None,
                date_from=None,
                date_to=None,
                include_inactive=True,
                include_stats=True,
                include_preview=True,
                limit=50,
                offset=0,
                order_by="ts",
                order="desc",
                preview_len=120,
                db=session,
            )

        self.assertEqual(result.count, 1)
        self.assertEqual(len(result.items), 1)


if __name__ == "__main__":
    unittest.main()

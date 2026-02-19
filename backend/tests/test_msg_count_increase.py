from __future__ import annotations

import sys
import unittest
from typing import cast, override
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeMeta
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.api import stats as stats_api
from backend.app.database import Base as _Base  # pyright: ignore[reportAny]
from backend.app.models import Account, Diary, DiaryMsgCountEvent, User

Base = cast(DeclarativeMeta, _Base)


class MsgCountIncreaseTests(unittest.IsolatedAsyncioTestCase):
    engine: AsyncEngine | None = None
    session_factory: async_sessionmaker[AsyncSession] | None = None

    @override
    async def asyncSetUp(self):
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.engine = engine
        self.session_factory = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    @override
    async def asyncTearDown(self):
        if self.engine is not None:
            await self.engine.dispose()

    async def _seed_min_case_total_6(self) -> dict[str, int]:
        now_utc = datetime.now(timezone.utc)
        now_naive_utc = now_utc.replace(tzinfo=None)
        t0 = now_naive_utc - timedelta(minutes=10)
        t1 = now_naive_utc - timedelta(minutes=5)
        t2 = now_naive_utc - timedelta(minutes=3)

        if self.session_factory is None:
            raise AssertionError("session_factory not initialized")

        async with self.session_factory() as session:
            u1 = User(nideriji_userid=10001, name="账号1用户")
            u2 = User(nideriji_userid=10002, name="账号2用户")
            a1 = Account(
                nideriji_userid=10001,
                auth_token="token-a1",
                email="a1@example.com",
                is_active=True,
            )
            a2 = Account(
                nideriji_userid=10002,
                auth_token="token-a2",
                email="a2@example.com",
                is_active=True,
            )
            session.add_all([u1, u2, a1, a2])
            await session.flush()

            d1 = Diary(
                nideriji_diary_id=900001,
                user_id=u1.id,
                account_id=a1.id,
                title="A1 的记录",
                created_date=date.today(),
                created_time=now_utc,
                created_at=now_utc,
                msg_count=10,
                ts=1700000000001,
            )
            d2 = Diary(
                nideriji_diary_id=900002,
                user_id=u2.id,
                account_id=a2.id,
                title="A2 的记录",
                created_date=date.today(),
                created_time=now_utc,
                created_at=now_utc,
                msg_count=20,
                ts=1700000000002,
            )
            session.add_all([d1, d2])
            await session.flush()

            e1 = DiaryMsgCountEvent(
                account_id=a1.id,
                diary_id=d1.id,
                old_msg_count=0,
                new_msg_count=2,
                delta=2,
                recorded_at=t0,
                source="sync",
            )
            e2 = DiaryMsgCountEvent(
                account_id=a1.id,
                diary_id=d1.id,
                old_msg_count=2,
                new_msg_count=5,
                delta=3,
                recorded_at=t1,
                source="sync",
            )
            e3 = DiaryMsgCountEvent(
                account_id=a2.id,
                diary_id=d2.id,
                old_msg_count=10,
                new_msg_count=11,
                delta=1,
                recorded_at=t2,
                source="refresh",
            )
            session.add_all([e1, e2, e3])
            await session.commit()

            account1_id = await session.scalar(
                select(Account.id).where(Account.nideriji_userid == 10001)
            )
            account2_id = await session.scalar(
                select(Account.id).where(Account.nideriji_userid == 10002)
            )
            diary1_id = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 900001)
            )
            diary2_id = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 900002)
            )

            if not isinstance(account1_id, int) or not isinstance(account2_id, int):
                raise AssertionError("seed accounts failed")
            if not isinstance(diary1_id, int) or not isinstance(diary2_id, int):
                raise AssertionError("seed diaries failed")

            return {
                "account1_id": account1_id,
                "account2_id": account2_id,
                "diary1_id": diary1_id,
                "diary2_id": diary2_id,
            }

    async def test_total_delta_aggregation_sort_and_limit(self):
        ids = await self._seed_min_case_total_6()
        assert self.session_factory is not None
        assert self.engine is not None

        now_utc = datetime.now(timezone.utc)
        since_ms = int((now_utc - timedelta(hours=1)).timestamp() * 1000)
        until_ms = int((now_utc + timedelta(hours=1)).timestamp() * 1000)

        async with self.session_factory() as session:
            with patch.object(stats_api, "engine", self.engine):
                result = await stats_api.get_msg_count_increase(
                    since_ms=since_ms,
                    until_ms=until_ms,
                    limit=20,
                    db=session,
                )

        self.assertEqual(result.total_delta, 6)

        self.assertEqual(len(result.items), 2)
        got_pairs = {(it.account_id, it.diary_id) for it in result.items}
        self.assertEqual(
            got_pairs,
            {
                (ids["account1_id"], ids["diary1_id"]),
                (ids["account2_id"], ids["diary2_id"]),
            },
        )

        self.assertEqual(result.items[0].delta, 5)
        self.assertEqual(result.items[0].account_id, ids["account1_id"])
        self.assertEqual(result.items[0].diary_id, ids["diary1_id"])
        last0 = result.items[0].last_event_at
        self.assertIsNotNone(last0)
        assert last0 is not None
        self.assertIs(last0.tzinfo, timezone.utc)

        async with self.session_factory() as session:
            with patch.object(stats_api, "engine", self.engine):
                limited = await stats_api.get_msg_count_increase(
                    since_ms=since_ms,
                    until_ms=until_ms,
                    limit=1,
                    db=session,
                )

        self.assertEqual(limited.total_delta, 6)
        self.assertEqual(len(limited.items), 1)
        self.assertEqual(limited.items[0].delta, 5)

    async def test_items_order_by_last_event_at_when_delta_ties(self):
        now_utc = datetime.now(timezone.utc)
        now_naive_utc = now_utc.replace(tzinfo=None)
        t0 = now_naive_utc - timedelta(minutes=30)
        t1 = now_naive_utc - timedelta(minutes=20)
        t2 = now_naive_utc - timedelta(minutes=10)

        assert self.session_factory is not None
        assert self.engine is not None

        async with self.session_factory() as session:
            u1 = User(nideriji_userid=20001, name="账号1用户")
            u2 = User(nideriji_userid=20002, name="账号2用户")
            a1 = Account(
                nideriji_userid=20001,
                auth_token="token-a1",
                email="a1@example.com",
                is_active=True,
            )
            a2 = Account(
                nideriji_userid=20002,
                auth_token="token-a2",
                email="a2@example.com",
                is_active=True,
            )
            session.add_all([u1, u2, a1, a2])
            await session.flush()

            d1 = Diary(
                nideriji_diary_id=910001,
                user_id=u1.id,
                account_id=a1.id,
                title="A1 的记录",
                created_date=date.today(),
                created_time=now_utc,
                created_at=now_utc,
                msg_count=10,
                ts=1700000100001,
            )
            d2 = Diary(
                nideriji_diary_id=910002,
                user_id=u2.id,
                account_id=a2.id,
                title="A2 的记录",
                created_date=date.today(),
                created_time=now_utc,
                created_at=now_utc,
                msg_count=20,
                ts=1700000100002,
            )
            session.add_all([d1, d2])
            await session.flush()

            session.add_all(
                [
                    DiaryMsgCountEvent(
                        account_id=a1.id,
                        diary_id=d1.id,
                        old_msg_count=0,
                        new_msg_count=2,
                        delta=2,
                        recorded_at=t0,
                        source="sync",
                    ),
                    DiaryMsgCountEvent(
                        account_id=a1.id,
                        diary_id=d1.id,
                        old_msg_count=2,
                        new_msg_count=5,
                        delta=3,
                        recorded_at=t1,
                        source="sync",
                    ),
                    DiaryMsgCountEvent(
                        account_id=a2.id,
                        diary_id=d2.id,
                        old_msg_count=0,
                        new_msg_count=5,
                        delta=5,
                        recorded_at=t2,
                        source="refresh",
                    ),
                ]
            )
            await session.commit()

        since_ms = int((now_utc - timedelta(hours=1)).timestamp() * 1000)
        until_ms = int((now_utc + timedelta(hours=1)).timestamp() * 1000)

        async with self.session_factory() as session:
            with patch.object(stats_api, "engine", self.engine):
                result = await stats_api.get_msg_count_increase(
                    since_ms=since_ms,
                    until_ms=until_ms,
                    limit=20,
                    db=session,
                )

        self.assertEqual(len(result.items), 2)
        self.assertEqual(result.items[0].delta, 5)
        self.assertEqual(result.items[1].delta, 5)
        last_a = result.items[0].last_event_at
        last_b = result.items[1].last_event_at
        self.assertIsNotNone(last_a)
        self.assertIsNotNone(last_b)
        assert last_a is not None
        assert last_b is not None
        self.assertTrue(last_a > last_b)

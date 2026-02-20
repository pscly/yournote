from __future__ import annotations

import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from typing import cast, override
from unittest.mock import patch

from fastapi import HTTPException
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

from backend.app.api import diaries as diaries_api
from backend.app.database import Base as _Base  # pyright: ignore[reportAny]
from backend.app.models import Account, Diary, User
from backend.app.schemas import (
    DiaryBookmarkBatchUpsertRequest,
    DiaryBookmarkUpsertRequest,
)

Base = cast(DeclarativeMeta, _Base)


class DiaryBookmarkTests(unittest.IsolatedAsyncioTestCase):
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

    async def _seed_one_diary(self) -> int:
        assert self.session_factory is not None
        now = datetime.now(timezone.utc)
        async with self.session_factory() as session:
            u1 = User(nideriji_userid=31001, name="用户")
            a1 = Account(
                nideriji_userid=31001,
                auth_token="token-a1",
                email="a1@example.com",
                is_active=True,
            )
            session.add_all([u1, a1])
            await session.flush()

            d1 = Diary(
                nideriji_diary_id=990001,
                user_id=u1.id,
                account_id=a1.id,
                title="d1",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                msg_count=0,
                ts=1700000000001,
                bookmarked_at=None,
            )
            session.add(d1)
            await session.commit()

            diary_id = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 990001)
            )
            if not isinstance(diary_id, int):
                raise AssertionError("seed diary failed")
            return diary_id

    async def test_set_true_then_idempotent_set_true(self):
        diary_id = await self._seed_one_diary()
        assert self.session_factory is not None
        assert self.engine is not None

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                r1 = await diaries_api.upsert_diary_bookmark(
                    diary_id=diary_id,
                    req=DiaryBookmarkUpsertRequest(bookmarked=True),
                    db=session,
                )

        self.assertIsNotNone(r1.bookmarked_at)
        assert r1.bookmarked_at is not None

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                r2 = await diaries_api.upsert_diary_bookmark(
                    diary_id=diary_id,
                    req=DiaryBookmarkUpsertRequest(bookmarked=True),
                    db=session,
                )

        self.assertEqual(r2.bookmarked_at, r1.bookmarked_at)

    async def test_set_false_then_idempotent_set_false(self):
        diary_id = await self._seed_one_diary()
        assert self.session_factory is not None
        assert self.engine is not None

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                r1 = await diaries_api.upsert_diary_bookmark(
                    diary_id=diary_id,
                    req=DiaryBookmarkUpsertRequest(bookmarked=True),
                    db=session,
                )

        self.assertIsNotNone(r1.bookmarked_at)

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                r2 = await diaries_api.upsert_diary_bookmark(
                    diary_id=diary_id,
                    req=DiaryBookmarkUpsertRequest(bookmarked=False),
                    db=session,
                )
                r3 = await diaries_api.upsert_diary_bookmark(
                    diary_id=diary_id,
                    req=DiaryBookmarkUpsertRequest(bookmarked=False),
                    db=session,
                )

        self.assertIsNone(r2.bookmarked_at)
        self.assertIsNone(r3.bookmarked_at)

    async def test_query_bookmarked_filter_and_order_by_bookmarked_at_nulls_last(self):
        assert self.session_factory is not None
        assert self.engine is not None
        now = datetime.now(timezone.utc)

        d1_id: int
        d2_id: int
        d3_id: int
        async with self.session_factory() as session:
            u1 = User(nideriji_userid=32001, name="用户")
            a1 = Account(
                nideriji_userid=32001,
                auth_token="token-a1",
                email="a1@example.com",
                is_active=True,
            )
            session.add_all([u1, a1])
            await session.flush()

            d1 = Diary(
                nideriji_diary_id=991001,
                user_id=u1.id,
                account_id=a1.id,
                title="d1",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                msg_count=0,
                ts=1700000000001,
                bookmarked_at=1000,
            )
            d2 = Diary(
                nideriji_diary_id=991002,
                user_id=u1.id,
                account_id=a1.id,
                title="d2",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                msg_count=0,
                ts=1700000000002,
                bookmarked_at=None,
            )
            d3 = Diary(
                nideriji_diary_id=991003,
                user_id=u1.id,
                account_id=a1.id,
                title="d3",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                msg_count=0,
                ts=1700000000003,
                bookmarked_at=2000,
            )
            session.add_all([d1, d2, d3])
            await session.commit()

            v1 = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 991001)
            )
            v2 = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 991002)
            )
            v3 = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 991003)
            )
            if (
                not isinstance(v1, int)
                or not isinstance(v2, int)
                or not isinstance(v3, int)
            ):
                raise AssertionError("seed diaries failed")
            d1_id, d2_id, d3_id = v1, v2, v3

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                resp = await diaries_api.query_diaries(
                    q=None,
                    q_mode="and",
                    q_syntax="plain",
                    scope="all",
                    account_id=None,
                    user_id=None,
                    date_from=None,
                    date_to=None,
                    include_inactive=True,
                    include_stats=False,
                    include_preview=False,
                    bookmarked=True,
                    limit=50,
                    offset=0,
                    order_by="bookmarked_at",
                    order="desc",
                    preview_len=0,
                    db=session,
                )

        got_ids = [it.id for it in resp.items]
        self.assertEqual(set(got_ids), {d1_id, d3_id})

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                resp2 = await diaries_api.query_diaries(
                    q=None,
                    q_mode="and",
                    q_syntax="plain",
                    scope="all",
                    account_id=None,
                    user_id=None,
                    date_from=None,
                    date_to=None,
                    include_inactive=True,
                    include_stats=False,
                    include_preview=False,
                    bookmarked=None,
                    limit=50,
                    offset=0,
                    order_by="bookmarked_at",
                    order="desc",
                    preview_len=0,
                    db=session,
                )

        got_ids2 = [it.id for it in resp2.items]
        self.assertEqual(got_ids2, [d3_id, d1_id, d2_id])

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                resp3 = await diaries_api.query_diaries(
                    q=None,
                    q_mode="and",
                    q_syntax="plain",
                    scope="all",
                    account_id=None,
                    user_id=None,
                    date_from=None,
                    date_to=None,
                    include_inactive=True,
                    include_stats=False,
                    include_preview=False,
                    bookmarked=None,
                    limit=50,
                    offset=0,
                    order_by="bookmarked_at",
                    order="asc",
                    preview_len=0,
                    db=session,
                )

        got_ids3 = [it.id for it in resp3.items]
        self.assertEqual(got_ids3, [d1_id, d3_id, d2_id])

    async def test_batch_clear_bookmarks_is_idempotent(self):
        assert self.session_factory is not None
        assert self.engine is not None
        now = datetime.now(timezone.utc)

        async with self.session_factory() as session:
            u1 = User(nideriji_userid=33001, name="用户")
            a1 = Account(
                nideriji_userid=33001,
                auth_token="token-a1",
                email="a1@example.com",
                is_active=True,
            )
            session.add_all([u1, a1])
            await session.flush()

            d1 = Diary(
                nideriji_diary_id=992001,
                user_id=u1.id,
                account_id=a1.id,
                title="d1",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                msg_count=0,
                ts=1700000000101,
                bookmarked_at=1111,
            )
            d2 = Diary(
                nideriji_diary_id=992002,
                user_id=u1.id,
                account_id=a1.id,
                title="d2",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                msg_count=0,
                ts=1700000000102,
                bookmarked_at=2222,
            )
            d3 = Diary(
                nideriji_diary_id=992003,
                user_id=u1.id,
                account_id=a1.id,
                title="d3",
                created_date=date.today(),
                created_time=now,
                created_at=now,
                msg_count=0,
                ts=1700000000103,
                bookmarked_at=None,
            )
            session.add_all([d1, d2, d3])
            await session.commit()

            v1 = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 992001)
            )
            v2 = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 992002)
            )
            v3 = await session.scalar(
                select(Diary.id).where(Diary.nideriji_diary_id == 992003)
            )
            if (
                not isinstance(v1, int)
                or not isinstance(v2, int)
                or not isinstance(v3, int)
            ):
                raise AssertionError("seed diaries failed")
            d1_id, d2_id, d3_id = v1, v2, v3

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                resp = await diaries_api.upsert_diary_bookmarks_batch(
                    req=DiaryBookmarkBatchUpsertRequest(
                        diary_ids=[d1_id, d2_id, d3_id, d2_id, -1, 0, 999999],
                        bookmarked=False,
                    ),
                    db=session,
                )

        self.assertEqual(resp.updated, 2)
        got = {it.diary_id: it.bookmarked_at for it in resp.items}
        self.assertEqual(set(got.keys()), {d1_id, d2_id, d3_id})
        self.assertIsNone(got[d1_id])
        self.assertIsNone(got[d2_id])
        self.assertIsNone(got[d3_id])

        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                resp2 = await diaries_api.upsert_diary_bookmarks_batch(
                    req=DiaryBookmarkBatchUpsertRequest(
                        diary_ids=[d1_id, d2_id, d3_id],
                        bookmarked=False,
                    ),
                    db=session,
                )

        self.assertEqual(resp2.updated, 0)

    async def test_set_bookmark_404_when_diary_missing(self):
        assert self.session_factory is not None
        assert self.engine is not None
        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                with self.assertRaises(HTTPException) as ctx:
                    _ = await diaries_api.upsert_diary_bookmark(
                        diary_id=999999,
                        req=DiaryBookmarkUpsertRequest(bookmarked=True),
                        db=session,
                    )
        self.assertEqual(ctx.exception.status_code, 404)

from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from backend.app.config import settings
from backend.app.database import Base
from backend.app.models import Account, Diary, DiaryDetailFetch, User
from backend.app.services.collector import CollectorService


class DetailFetchGiveUpForOldDiaryTests(unittest.IsolatedAsyncioTestCase):
    engine: AsyncEngine | None = None
    session_factory: async_sessionmaker[AsyncSession] | None = None

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
        if self.engine is not None:
            await self.engine.dispose()

    async def _seed_one_diary_with_detail_fetch_state(
        self,
        *,
        attempts: int,
        diary_id: int = 900001,
        user_nideriji_id: int = 10001,
    ) -> dict[str, int]:
        if self.session_factory is None:
            raise AssertionError("session_factory not initialized")

        async with self.session_factory() as session:
            user = User(nideriji_userid=user_nideriji_id, name="测试用户")
            account = Account(
                nideriji_userid=user_nideriji_id,
                auth_token="token-test",
                email="test@example.com",
                is_active=True,
            )
            session.add_all([user, account])
            await session.flush()

            now_utc = datetime.now(timezone.utc)
            diary = Diary(
                nideriji_diary_id=diary_id,
                user_id=user.id,
                account_id=account.id,
                title="短内容日记",
                content="短内容",
                created_date=date.today(),
                created_time=now_utc,
                created_at=now_utc,
                ts=1700000000000,
                msg_count=0,
                is_simple=0,
            )
            session.add(diary)
            await session.flush()

            state = DiaryDetailFetch(
                diary_id=diary.id,
                nideriji_diary_id=diary_id,
                attempts=int(attempts),
                last_detail_success=False,
                last_detail_is_short=False,
            )
            session.add(state)
            await session.commit()

            return {
                "account_id": int(account.id),
                "user_id": int(user.id),
                "diary_db_id": int(diary.id),
                "nideriji_diary_id": int(diary_id),
            }

    async def _run_save_diaries(
        self,
        *,
        attempts: int,
        created_at: datetime,
        give_up_days: int = 3,
        max_attempts: int = 3,
    ) -> CollectorService:
        ids = await self._seed_one_diary_with_detail_fetch_state(attempts=attempts)

        if self.session_factory is None:
            raise AssertionError("session_factory not initialized")

        created_utc = created_at.astimezone(timezone.utc)
        diary_data = {
            "id": ids["nideriji_diary_id"],
            "title": "短内容日记",
            "content": "短内容",
            "is_simple": 0,
            "createddate": created_utc.strftime("%Y-%m-%d"),
            "createdtime": int(created_utc.timestamp()),
            "msg_count": 0,
            "ts": 1700000000000,
        }

        # 固定阈值，避免外部 .env 干扰测试。
        old_days = getattr(settings, "diary_detail_fetch_old_give_up_days", 3)
        old_max = getattr(settings, "diary_detail_fetch_old_max_attempts", 3)
        settings.diary_detail_fetch_old_give_up_days = int(give_up_days)
        settings.diary_detail_fetch_old_max_attempts = int(max_attempts)

        try:
            async with self.session_factory() as session:
                collector = CollectorService(session)
                collector.fetch_nideriji_diaries_by_ids = AsyncMock(
                    return_value={
                        ids["nideriji_diary_id"]: {
                            "id": ids["nideriji_diary_id"],
                            "title": "短内容日记(补全)",
                            "content": "x" * 200,
                            "createddate": diary_data["createddate"],
                            "createdtime": diary_data["createdtime"],
                            "is_simple": 0,
                            "msg_count": 0,
                            "ts": 1700000000000,
                        }
                    }
                )
                await collector._save_diaries(
                    [diary_data],
                    account_id=ids["account_id"],
                    user_nideriji_id=10001,
                    auth_token="token-test",
                )
                return collector
        finally:
            settings.diary_detail_fetch_old_give_up_days = old_days
            settings.diary_detail_fetch_old_max_attempts = old_max

    async def test_old_diary_attempts_ge_max_skips_all_by_ids(self):
        now = datetime.now(timezone.utc)
        old_created = now - timedelta(days=4)

        collector = await self._run_save_diaries(attempts=3, created_at=old_created)
        self.assertEqual(collector.fetch_nideriji_diaries_by_ids.await_count, 0)

    async def test_old_diary_attempts_lt_max_still_calls_all_by_ids(self):
        now = datetime.now(timezone.utc)
        old_created = now - timedelta(days=4)

        collector = await self._run_save_diaries(attempts=2, created_at=old_created)
        self.assertEqual(collector.fetch_nideriji_diaries_by_ids.await_count, 1)

    async def test_recent_diary_attempts_ge_max_still_calls_all_by_ids(self):
        now = datetime.now(timezone.utc)
        recent_created = now - timedelta(days=1)

        collector = await self._run_save_diaries(attempts=3, created_at=recent_created)
        self.assertEqual(collector.fetch_nideriji_diaries_by_ids.await_count, 1)

    async def test_disabled_when_give_up_days_non_positive(self):
        now = datetime.now(timezone.utc)
        old_created = now - timedelta(days=10)

        collector = await self._run_save_diaries(
            attempts=3,
            created_at=old_created,
            give_up_days=0,
            max_attempts=3,
        )
        self.assertEqual(collector.fetch_nideriji_diaries_by_ids.await_count, 1)


if __name__ == "__main__":
    unittest.main()

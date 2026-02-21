from __future__ import annotations

import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import diaries as diaries_api
from app.database import Base
from app.models import Account, Diary, User


class DiaryQueryHasMsgTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with self.session_factory() as session:
            user = User(nideriji_userid=10001, name="测试用户")
            account = Account(
                nideriji_userid=10001,
                auth_token="token test",
                email="test@example.com",
                is_active=True,
            )
            session.add_all([user, account])
            await session.flush()

            now = datetime.now(timezone.utc)
            session.add_all(
                [
                    Diary(
                        nideriji_diary_id=90001,
                        user_id=user.id,
                        account_id=account.id,
                        title="无留言",
                        content="x",
                        created_date=date(2026, 2, 18),
                        created_time=now,
                        created_at=now,
                        ts=1700000000000,
                        msg_count=0,
                    ),
                    Diary(
                        nideriji_diary_id=90002,
                        user_id=user.id,
                        account_id=account.id,
                        title="有留言 1",
                        content="x",
                        created_date=date(2026, 2, 19),
                        created_time=now,
                        created_at=now,
                        ts=1700000000001,
                        msg_count=1,
                    ),
                    Diary(
                        nideriji_diary_id=90003,
                        user_id=user.id,
                        account_id=account.id,
                        title="有留言 3",
                        content="x",
                        created_date=date(2026, 2, 20),
                        created_time=now,
                        created_at=now,
                        ts=1700000000002,
                        msg_count=3,
                    ),
                ]
            )
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_has_msg_true_filters_and_orders_by_msg_count_desc(self):
        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                result = await diaries_api.query_diaries(
                    q=None,
                    q_mode="and",
                    q_syntax="smart",
                    scope="all",
                    account_id=None,
                    user_id=None,
                    date_from=None,
                    date_to=None,
                    include_inactive=True,
                    include_stats=True,
                    include_preview=True,
                    bookmarked=None,
                    has_msg=True,
                    limit=50,
                    offset=0,
                    order_by="msg_count",
                    order="desc",
                    preview_len=120,
                    db=session,
                )

        self.assertEqual(result.count, 2)
        self.assertEqual([i.msg_count for i in result.items], [3, 1])

    async def test_has_msg_false_filters_only_zero(self):
        async with self.session_factory() as session:
            with patch.object(diaries_api, "engine", self.engine):
                result = await diaries_api.query_diaries(
                    q=None,
                    q_mode="and",
                    q_syntax="smart",
                    scope="all",
                    account_id=None,
                    user_id=None,
                    date_from=None,
                    date_to=None,
                    include_inactive=True,
                    include_stats=True,
                    include_preview=True,
                    bookmarked=None,
                    has_msg=False,
                    limit=50,
                    offset=0,
                    order_by="msg_count",
                    order="desc",
                    preview_len=120,
                    db=session,
                )

        self.assertEqual(result.count, 1)
        self.assertEqual([i.msg_count for i in result.items], [0])


if __name__ == "__main__":
    unittest.main()

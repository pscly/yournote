from __future__ import annotations

import unittest
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from backend.app.api.users import get_paired_users
from backend.app.database import Base
from backend.app.models import Account, PairedRelationship, User


class UsersPairedIncludeInactiveTests(unittest.IsolatedAsyncioTestCase):
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

    async def _seed_relationships(self, *, session: AsyncSession) -> int:
        now = datetime.now(timezone.utc)

        owner = User(
            nideriji_userid=310001,
            name="主用户",
            diary_count=0,
            word_count=0,
            image_count=0,
            created_at=now,
        )
        paired_active = User(
            nideriji_userid=310002,
            name="配对用户-启用",
            diary_count=0,
            word_count=0,
            image_count=0,
            created_at=now,
        )
        paired_inactive = User(
            nideriji_userid=310003,
            name="配对用户-停用",
            diary_count=0,
            word_count=0,
            image_count=0,
            created_at=now,
        )
        account = Account(
            nideriji_userid=owner.nideriji_userid,
            auth_token="token test",
            email="test@example.com",
            is_active=True,
        )
        session.add_all([owner, paired_active, paired_inactive, account])
        await session.flush()

        rel_active = PairedRelationship(
            account_id=account.id,
            user_id=owner.id,
            paired_user_id=paired_active.id,
            is_active=True,
        )
        rel_inactive = PairedRelationship(
            account_id=account.id,
            user_id=owner.id,
            paired_user_id=paired_inactive.id,
            is_active=False,
        )
        session.add_all([rel_active, rel_inactive])
        await session.commit()
        return int(getattr(account, "id", 0) or 0)

    async def test_include_inactive_false_returns_only_active(self):
        session_factory = self.session_factory
        assert session_factory is not None

        async with session_factory() as session:
            account_id = await self._seed_relationships(session=session)

            rows = await get_paired_users(
                account_id=account_id,
                include_inactive=False,
                db=session,
            )

            self.assertEqual(len(rows), 1)
            self.assertTrue(all("is_active" in r for r in rows))
            self.assertTrue(all(bool(r["is_active"]) is True for r in rows))

    async def test_include_inactive_true_returns_active_and_inactive(self):
        session_factory = self.session_factory
        assert session_factory is not None

        async with session_factory() as session:
            account_id = await self._seed_relationships(session=session)

            rows = await get_paired_users(
                account_id=account_id,
                include_inactive=True,
                db=session,
            )

            self.assertEqual(len(rows), 2)
            self.assertTrue(all("is_active" in r for r in rows))

            active_flags = {bool(r["is_active"]) for r in rows}
            self.assertEqual(active_flags, {True, False})


if __name__ == "__main__":
    unittest.main()

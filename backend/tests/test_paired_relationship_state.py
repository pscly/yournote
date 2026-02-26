from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from backend.app.database import Base
from backend.app.models import Account, PairedRelationship, User
from backend.app.services.collector import CollectorService


class PairedRelationshipStateTests(unittest.IsolatedAsyncioTestCase):
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

    async def _seed_account_with_relationship(
        self,
        *,
        session,
        main_nideriji_userid: int,
        paired_nideriji_userid: int,
        is_active: bool,
    ) -> tuple[Account, User, User, PairedRelationship]:
        main_user = User(nideriji_userid=main_nideriji_userid, name="主用户")
        paired_user = User(nideriji_userid=paired_nideriji_userid, name="配对用户")
        account = Account(
            nideriji_userid=main_nideriji_userid,
            auth_token="token test",
            email="test@example.com",
            is_active=True,
        )
        session.add_all([main_user, paired_user, account])
        await session.flush()

        rel = PairedRelationship(
            account_id=account.id,
            user_id=main_user.id,
            paired_user_id=paired_user.id,
            is_active=is_active,
        )
        session.add(rel)
        await session.commit()
        return account, main_user, paired_user, rel

    async def test_empty_diaries_paired_deactivates_all_active_relationships(self):
        cases = [
            ("missing", {}),
            ("none", {"diaries_paired": None}),
            ("empty_list", {"diaries_paired": []}),
            ("non_list", {"diaries_paired": ""}),
        ]

        for idx, (name, extra) in enumerate(cases, start=1):
            main_uid = 10000 + idx
            paired_uid = 20000 + idx

            with self.subTest(name=name):
                session_factory = self.session_factory
                assert session_factory is not None
                async with session_factory() as session:
                    account, *_ = await self._seed_account_with_relationship(
                        session=session,
                        main_nideriji_userid=main_uid,
                        paired_nideriji_userid=paired_uid,
                        is_active=True,
                    )
                    account_id = int(getattr(account, "id", 0) or 0)

                    service = CollectorService(session)
                    service.fetch_nideriji_data_for_account = AsyncMock(
                        return_value={
                            "user_config": {
                                "userid": main_uid,
                                "paired_user_config": {
                                    "userid": paired_uid,
                                    "name": "配对用户",
                                },
                            },
                            "diaries": [],
                            **extra,
                        }
                    )
                    service._save_diaries = AsyncMock(return_value=(0, []))

                    await service.sync_account(account_id)

                    rows = (
                        (
                            await session.execute(
                                select(PairedRelationship).where(
                                    PairedRelationship.account_id == account_id
                                )
                            )
                        )
                        .scalars()
                        .all()
                    )
                    self.assertGreaterEqual(len(rows), 1)
                    self.assertTrue(all(not bool(r.is_active) for r in rows))

    async def test_non_empty_diaries_paired_reactivates_and_keeps_single_active(self):
        session_factory = self.session_factory
        assert session_factory is not None
        async with session_factory() as session:
            main_uid = 11001
            paired_uid_1 = 21001
            paired_uid_2 = 21002

            owner = User(nideriji_userid=main_uid, name="主用户")
            paired1 = User(nideriji_userid=paired_uid_1, name="配对 1")
            paired2 = User(nideriji_userid=paired_uid_2, name="配对 2")
            account = Account(
                nideriji_userid=main_uid,
                auth_token="token test",
                email="test@example.com",
                is_active=True,
            )
            session.add_all([owner, paired1, paired2, account])
            await session.flush()

            rel_active = PairedRelationship(
                account_id=account.id,
                user_id=owner.id,
                paired_user_id=paired1.id,
                is_active=True,
            )
            rel_inactive = PairedRelationship(
                account_id=account.id,
                user_id=owner.id,
                paired_user_id=paired2.id,
                is_active=False,
            )
            session.add_all([rel_active, rel_inactive])
            await session.commit()
            account_id = int(getattr(account, "id", 0) or 0)

            paired_time_ts = 1700000000
            expected_paired_time = datetime.fromtimestamp(
                float(paired_time_ts), tz=timezone.utc
            ).replace(tzinfo=None)

            rdata = {
                "user_config": {
                    "userid": main_uid,
                    "paired_user_config": {
                        "userid": paired_uid_2,
                        "name": "配对 2",
                        "paired_time": paired_time_ts,
                    },
                },
                "diaries": [],
                "diaries_paired": [{"id": 1}],
            }

            service = CollectorService(session)
            service.fetch_nideriji_data_for_account = AsyncMock(return_value=rdata)
            service._save_diaries = AsyncMock(return_value=(0, []))

            await service.sync_account(account_id)
            await service.sync_account(account_id)

            rels = (
                (
                    await session.execute(
                        select(PairedRelationship)
                        .where(PairedRelationship.account_id == account_id)
                        .order_by(PairedRelationship.id.asc())
                    )
                )
                .scalars()
                .all()
            )
            self.assertEqual(len(rels), 2)

            active = [r for r in rels if bool(r.is_active)]
            self.assertEqual(len(active), 1)
            self.assertEqual(active[0].paired_user_id, paired2.id)
            self.assertEqual(active[0].paired_time, expected_paired_time)


if __name__ == "__main__":
    unittest.main()

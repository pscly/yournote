"""Scheduler for automatic data synchronization"""
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select
from .config import settings
from .database import AsyncSessionLocal
from .models import Account
from .services import CollectorService


class DataSyncScheduler:
    """数据同步定时任务调度器"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()

    async def sync_all_accounts(self):
        """同步所有活跃账号的数据"""
        print("[SYNC] Starting automatic sync for all accounts...")

        async with AsyncSessionLocal() as db:
            try:
                # 获取所有活跃账号
                result = await db.execute(
                    select(Account).where(Account.is_active == True)
                )
                accounts = result.scalars().all()

                if not accounts:
                    print("[SYNC] No active accounts found")
                    return

                # 同步每个账号
                collector = CollectorService(db)
                for account in accounts:
                    try:
                        print(f"[SYNC] Syncing account {account.nideriji_userid}...")
                        result = await collector.sync_account(account.id)
                        print(f"[SYNC] Account {account.nideriji_userid} synced: "
                              f"{result['diaries_count']} diaries, "
                              f"{result['paired_diaries_count']} paired diaries")
                    except Exception as e:
                        print(f"[SYNC] Failed to sync account {account.nideriji_userid}: {e}")

                print("[SYNC] Automatic sync completed")

            except Exception as e:
                print(f"[SYNC] Sync error: {e}")

    def start(self):
        """启动定时任务"""
        interval_minutes = int(getattr(settings, "sync_interval_minutes", 20) or 20)
        if interval_minutes <= 0:
            interval_minutes = 20

        # 添加定时执行的任务（按配置间隔运行）
        self.scheduler.add_job(
            self.sync_all_accounts,
            trigger=IntervalTrigger(minutes=interval_minutes),
            id='sync_all_accounts',
            name=f'Sync all accounts every {interval_minutes} minutes',
            replace_existing=True
        )

        self.scheduler.start()
        print(f"[SCHEDULER] Scheduler started: sync every {interval_minutes} minutes")

    def shutdown(self):
        """关闭定时任务"""
        self.scheduler.shutdown()
        print("[SCHEDULER] Scheduler stopped")


# 全局调度器实例
scheduler = DataSyncScheduler()

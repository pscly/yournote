"""Scheduler for automatic data synchronization"""
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select
from .config import settings
from .database import AsyncSessionLocal
from .models import Account
from .services import CollectorService

logger = logging.getLogger(__name__)


class DataSyncScheduler:
    """数据同步定时任务调度器"""

    def __init__(self):
        # 关键约束：
        # - max_instances=1：避免同步任务重入（上一次未完成时不并发启动下一次）
        # - coalesce=True：如果发生 misfire，则合并为一次执行（避免堆积）
        self.scheduler = AsyncIOScheduler(
            job_defaults={"coalesce": True, "max_instances": 1}
        )

    async def sync_all_accounts(self):
        """同步所有活跃账号的数据"""
        logger.info("[SYNC] Starting automatic sync for all accounts...")

        async with AsyncSessionLocal() as db:
            try:
                # 获取所有活跃账号
                result = await db.execute(
                    select(Account).where(Account.is_active.is_(True))
                )
                accounts = result.scalars().all()

                if not accounts:
                    logger.info("[SYNC] No active accounts found")
                    return

                # 同步每个账号
                collector = CollectorService(db)
                for account in accounts:
                    try:
                        logger.info(
                            "[SYNC] Syncing account userid=%s (account_id=%s)...",
                            account.nideriji_userid,
                            account.id,
                        )
                        sync_result = await collector.sync_account(account.id)
                        logger.info(
                            "[SYNC] Account userid=%s synced: diaries=%s paired_diaries=%s",
                            account.nideriji_userid,
                            sync_result.get("diaries_count"),
                            sync_result.get("paired_diaries_count"),
                        )
                    except Exception as e:
                        logger.exception(
                            "[SYNC] Failed to sync account userid=%s: %s",
                            account.nideriji_userid,
                            e,
                        )

                logger.info("[SYNC] Automatic sync completed")

            except Exception as e:
                logger.exception("[SYNC] Sync error: %s", e)

    def start(self):
        """启动定时任务"""
        interval_minutes = int(getattr(settings, "sync_interval_minutes", 20) or 20)
        if interval_minutes <= 0:
            interval_minutes = 20

        if getattr(self.scheduler, "running", False):
            logger.info("[SCHEDULER] Scheduler already running")
            return

        # 添加定时执行的任务（按配置间隔运行）
        self.scheduler.add_job(
            self.sync_all_accounts,
            trigger=IntervalTrigger(minutes=interval_minutes),
            id='sync_all_accounts',
            name=f'Sync all accounts every {interval_minutes} minutes',
            replace_existing=True
        )

        self.scheduler.start()
        logger.info("[SCHEDULER] Scheduler started: sync every %s minutes", interval_minutes)

    def shutdown(self):
        """关闭定时任务"""
        if not getattr(self.scheduler, "running", False):
            return
        self.scheduler.shutdown(wait=False)
        logger.info("[SCHEDULER] Scheduler stopped")


# 全局调度器实例
scheduler = DataSyncScheduler()

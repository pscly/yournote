"""Data collection service"""
import requests
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..models import Account, User, Diary, PairedRelationship, SyncLog, DiaryHistory


class CollectorService:
    """数据采集服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def fetch_nideriji_data(self, auth_token: str) -> dict:
        """从 nideriji API 获取数据"""
        url = "https://nideriji.cn/api/v2/sync/"
        headers = {
            'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            'accept-language': "zh-CN,zh;q=0.9,en;q=0.8",
            'auth': auth_token,
            'origin': "https://nideriji.cn",
            'referer': "https://nideriji.cn/w/",
        }
        response = requests.post(url, headers=headers)
        return response.json()

    async def sync_account(self, account_id: int) -> dict:
        """同步单个账号的数据"""
        result = await self.db.execute(
            select(Account).where(Account.id == account_id)
        )
        account = result.scalar_one_or_none()
        if not account:
            raise ValueError(f"Account {account_id} not found")

        try:
            rdata = await self.fetch_nideriji_data(account.auth_token)

            await self._save_user_info(rdata['user_config'], account_id)

            if rdata['user_config'].get('paired_user_config'):
                await self._save_paired_user_info(
                    rdata['user_config']['paired_user_config'],
                    account_id
                )

            diaries_count = await self._save_diaries(
                rdata['diaries'],
                account_id,
                rdata['user_config']['userid']
            )

            paired_diaries_count = 0
            if rdata.get('diaries_paired'):
                paired_user_id = rdata['user_config']['paired_user_config']['userid']
                paired_diaries_count = await self._save_diaries(
                    rdata['diaries_paired'],
                    account_id,
                    paired_user_id
                )

            await self._log_sync(account_id, 'success', diaries_count, paired_diaries_count)
            await self.db.commit()

            return {
                'status': 'success',
                'diaries_count': diaries_count,
                'paired_diaries_count': paired_diaries_count
            }
        except Exception as e:
            await self._log_sync(account_id, 'failed', 0, 0, str(e))
            await self.db.commit()
            raise

    async def _save_user_info(self, user_config: dict, account_id: int):
        """保存用户信息"""
        result = await self.db.execute(
            select(User).where(User.nideriji_userid == user_config['userid'])
        )
        user = result.scalar_one_or_none()

        last_login_time = None
        if user_config.get('last_login_time'):
            last_login_time = datetime.fromtimestamp(user_config['last_login_time'])

        if user:
            user.name = user_config.get('name')
            user.description = user_config.get('description')
            user.role = user_config.get('role')
            user.avatar = user_config.get('avatar')
            user.diary_count = user_config.get('diary_count', 0)
            user.word_count = user_config.get('word_count', 0)
            user.image_count = user_config.get('image_count', 0)
            user.last_login_time = last_login_time
        else:
            user = User(
                nideriji_userid=user_config['userid'],
                name=user_config.get('name'),
                description=user_config.get('description'),
                role=user_config.get('role'),
                avatar=user_config.get('avatar'),
                diary_count=user_config.get('diary_count', 0),
                word_count=user_config.get('word_count', 0),
                image_count=user_config.get('image_count', 0),
                last_login_time=last_login_time
            )
            self.db.add(user)

        await self.db.flush()
        return user

    async def _save_paired_user_info(self, paired_config: dict, account_id: int):
        """保存配对用户信息"""
        paired_user = await self._save_user_info({'userid': paired_config['userid'], **paired_config}, account_id)

        result = await self.db.execute(
            select(User).where(User.nideriji_userid == (
                await self.db.execute(
                    select(Account.nideriji_userid).where(Account.id == account_id)
                )
            ).scalar())
        )
        main_user = result.scalar_one_or_none()

        if main_user and paired_user:
            result = await self.db.execute(
                select(PairedRelationship).where(
                    PairedRelationship.account_id == account_id,
                    PairedRelationship.paired_user_id == paired_user.id
                )
            )
            relationship = result.scalar_one_or_none()

            if not relationship:
                paired_time = None
                if paired_config.get('paired_time'):
                    paired_time = datetime.fromtimestamp(paired_config['paired_time'])

                relationship = PairedRelationship(
                    account_id=account_id,
                    user_id=main_user.id,
                    paired_user_id=paired_user.id,
                    paired_time=paired_time,
                    is_active=True
                )
                self.db.add(relationship)

    async def _save_diaries(self, diaries: list, account_id: int, user_nideriji_id: int) -> int:
        """保存日记数据"""
        result = await self.db.execute(
            select(User).where(User.nideriji_userid == user_nideriji_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return 0

        count = 0
        for diary_data in diaries:
            result = await self.db.execute(
                select(Diary).where(Diary.nideriji_diary_id == diary_data['id'])
            )
            diary = result.scalar_one_or_none()

            created_time = None
            if diary_data.get('createdtime'):
                created_time = datetime.fromtimestamp(diary_data['createdtime'])

            if not diary:
                diary = Diary(
                    nideriji_diary_id=diary_data['id'],
                    user_id=user.id,
                    account_id=account_id,
                    title=diary_data.get('title', ''),
                    content=diary_data.get('content', ''),
                    created_date=datetime.strptime(diary_data['createddate'], '%Y-%m-%d').date(),
                    created_time=created_time,
                    weather=diary_data.get('weather', ''),
                    mood=diary_data.get('mood', ''),
                    mood_id=diary_data.get('mood_id'),
                    mood_color=diary_data.get('mood_color'),
                    space=diary_data.get('space', ''),
                    is_simple=diary_data.get('is_simple', 0),
                    msg_count=diary_data.get('msg_count', 0),
                    ts=diary_data.get('ts')
                )
                self.db.add(diary)
                count += 1
            else:
                # 检查内容是否有变化
                new_content = diary_data.get('content', '')
                new_title = diary_data.get('title', '')
                if diary.content != new_content or diary.title != new_title:
                    # 保存历史记录
                    history = DiaryHistory(
                        diary_id=diary.id,
                        nideriji_diary_id=diary.nideriji_diary_id,
                        title=diary.title,
                        content=diary.content,
                        weather=diary.weather,
                        mood=diary.mood,
                        ts=diary.ts
                    )
                    self.db.add(history)
                    # 更新日记
                    diary.title = new_title
                    diary.content = new_content
                    diary.weather = diary_data.get('weather', '')
                    diary.mood = diary_data.get('mood', '')
                    diary.ts = diary_data.get('ts')

        return count

    async def _log_sync(self, account_id: int, status: str, diaries_count: int,
                       paired_diaries_count: int, error_message: str = None):
        """记录同步日志"""
        log = SyncLog(
            account_id=account_id,
            status=status,
            diaries_count=diaries_count,
            paired_diaries_count=paired_diaries_count,
            error_message=error_message
        )
        self.db.add(log)

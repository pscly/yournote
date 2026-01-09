"""数据采集服务

说明：
- 主同步接口：`https://nideriji.cn/api/v2/sync/`
- 当日记内容过短（通常是公开日记的“简略内容”）时，会额外调用
  `https://nideriji.cn/api/diary/all_by_ids/{userid}/` 再取一次完整内容。

采集策略：
- 若数据库里已存在“完整内容”，则不会重复请求详情，也不会用短内容覆盖长内容。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Account,
    Diary,
    DiaryDetailFetch,
    DiaryHistory,
    PairedRelationship,
    SyncLog,
    User,
)


class CollectorService:
    """数据采集服务"""

    _DETAIL_CONTENT_MIN_LEN = 100
    _DETAIL_FETCH_BATCH_SIZE = 50
    _REQUEST_TIMEOUT_SECONDS = 15
    _LOGIN_TIMEOUT_SECONDS = 15

    def __init__(self, db: AsyncSession):
        self.db = db

    def _build_headers(self, auth_token: str) -> dict[str, str]:
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36"
            ),
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "auth": auth_token,
            "origin": "https://nideriji.cn",
            "referer": "https://nideriji.cn/w/",
        }

    def _build_login_headers(self) -> dict[str, str]:
        # 登录接口是传统表单提交，保持最小必要 header 即可。
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36"
            ),
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "origin": "https://nideriji.cn",
            "referer": "https://nideriji.cn/w/login",
        }

    async def login_nideriji(self, email: str, password: str) -> str:
        """使用账号密码登录 nideriji，返回可直接用于后续请求的 auth_token。

        返回形如：`token <jwt>`
        """
        url = "https://nideriji.cn/api/login/"
        payload = {"email": email, "password": password}
        resp = requests.post(
            url,
            data=payload,
            headers=self._build_login_headers(),
            timeout=self._LOGIN_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        data: Any = resp.json()
        if not isinstance(data, dict):
            raise ValueError("登录接口返回非 JSON 对象")
        if data.get("error") not in (0, None):
            raise ValueError(f"登录失败: error={data.get('error')}")
        token = data.get("token")
        if not isinstance(token, str) or not token.strip():
            raise ValueError("登录接口未返回 token")
        return f"token {token.strip()}"

    def _content_len(self, content: str | None) -> int:
        return len((content or "").strip())

    def _needs_detail_fetch(self, content: str | None, is_simple: Any) -> bool:
        if is_simple == 1:
            return True
        return self._content_len(content) < self._DETAIL_CONTENT_MIN_LEN

    async def _get_account_diary_totals(
        self,
        *,
        account_id: int,
        main_user_id: int,
    ) -> tuple[int, int]:
        """获取账号的“我的日记总数 / 配对日记总数”。

        说明：
        - “我的日记”：该账号主用户写的日记数量。
        - “配对日记”：同一账号下，除主用户外的所有用户日记数量之和。
        """

        my_total = await self.db.scalar(
            select(func.count())
            .select_from(Diary)
            .where(Diary.account_id == account_id, Diary.user_id == main_user_id)
        )
        paired_total = await self.db.scalar(
            select(func.count())
            .select_from(Diary)
            .where(Diary.account_id == account_id, Diary.user_id != main_user_id)
        )
        return int(my_total or 0), int(paired_total or 0)

    async def _get_detail_fetch_state_map(self, diary_db_ids: list[int]) -> dict[int, DiaryDetailFetch]:
        if not diary_db_ids:
            return {}
        result = await self.db.execute(
            select(DiaryDetailFetch).where(DiaryDetailFetch.diary_id.in_(diary_db_ids))
        )
        return {row.diary_id: row for row in result.scalars().all()}

    async def _upsert_detail_fetch_state(
        self,
        diary: Diary,
        *,
        success: bool,
        is_short: bool,
        content_len: int | None,
        error: str | None,
    ) -> None:
        """记录“all_by_ids 详情请求”的结果，用于后续跳过重复请求。"""
        result = await self.db.execute(
            select(DiaryDetailFetch).where(DiaryDetailFetch.diary_id == diary.id)
        )
        state = result.scalar_one_or_none()
        now = datetime.utcnow()

        if not state:
            state = DiaryDetailFetch(
                diary_id=diary.id,
                nideriji_diary_id=diary.nideriji_diary_id,
                attempts=0,
            )
            self.db.add(state)

        state.nideriji_diary_id = diary.nideriji_diary_id
        state.last_detail_at = now
        state.last_detail_success = bool(success)
        state.last_detail_is_short = bool(is_short) if success else False
        state.last_detail_content_len = content_len
        state.last_detail_error = error
        state.attempts = (state.attempts or 0) + 1

    async def fetch_nideriji_data(self, auth_token: str) -> dict:
        """从 nideriji API 获取数据"""
        url = "https://nideriji.cn/api/v2/sync/"
        headers = self._build_headers(auth_token)
        response = requests.post(
            url,
            headers=headers,
            timeout=self._REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()

    async def fetch_nideriji_data_for_account(self, account: Account) -> dict:
        """按账号获取 sync 数据，并在 token 失效时自动重新登录刷新 token。

        说明：
        - 仅在收到 401/403 且本地已保存 email + login_password 时触发一次重登
        - 成功后会把新 token 写回 account.auth_token（由调用方决定何时 commit）
        """
        try:
            return await self.fetch_nideriji_data(account.auth_token)
        except requests.HTTPError as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            can_relogin = (
                isinstance(status_code, int)
                and status_code in (401, 403)
                and isinstance(account.email, str)
                and account.email.strip()
                and isinstance(getattr(account, "login_password", None), str)
                and (account.login_password or "").strip()
            )
            if not can_relogin:
                raise

            new_token = await self.login_nideriji(account.email, account.login_password)
            account.auth_token = new_token
            await self.db.flush()
            return await self.fetch_nideriji_data(account.auth_token)

    async def fetch_nideriji_diaries_by_ids(
        self,
        auth_token: str,
        diary_owner_userid: int,
        diary_ids: list[int],
    ) -> dict[int, dict[str, Any]]:
        """按日记 id 列表拉取完整日记内容（用于补全简略内容）。

        参考：rdata解释.md 中的 `api/diary/all_by_ids/{userid}/`。

        返回：{nideriji_diary_id: diary_data}
        """
        if not diary_ids:
            return {}

        url = f"https://nideriji.cn/api/diary/all_by_ids/{diary_owner_userid}/"
        headers = self._build_headers(auth_token)

        # 接口支持一次传多个 id（字符串），这里做分批，避免过长的 form body。
        results: dict[int, dict[str, Any]] = {}
        for start in range(0, len(diary_ids), self._DETAIL_FETCH_BATCH_SIZE):
            batch = diary_ids[start : start + self._DETAIL_FETCH_BATCH_SIZE]
            payload = {"diary_ids": ",".join(str(diary_id) for diary_id in batch)}
            resp = requests.post(
                url,
                data=payload,
                headers=headers,
                timeout=self._REQUEST_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            data: Any = resp.json()

            diary_list: list[dict[str, Any]] = []
            if isinstance(data, list):
                diary_list = [d for d in data if isinstance(d, dict)]
            elif isinstance(data, dict):
                for key in ("diaries", "data", "result", "items"):
                    value = data.get(key)
                    if isinstance(value, list):
                        diary_list = [d for d in value if isinstance(d, dict)]
                        break
                if not diary_list and isinstance(data.get("diary"), dict):
                    diary_list = [data["diary"]]

            for d in diary_list:
                diary_id = d.get("id") or d.get("diary_id")
                if isinstance(diary_id, int):
                    results[diary_id] = d

        return results

    def _merge_diary_data(self, base: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
        """用详情数据补全/覆盖主接口返回的简略字段。"""
        merged = dict(base)
        for key in (
            "title",
            "content",
            "weather",
            "mood",
            "mood_id",
            "mood_color",
            "space",
            "is_simple",
            "msg_count",
            "createddate",
            "createdtime",
            "ts",
        ):
            if key in detail and detail[key] is not None:
                merged[key] = detail[key]
        return merged

    async def refresh_diary(self, diary_id: int) -> tuple[Diary, dict[str, Any]]:
        """强制刷新某条日记内容（仍然遵循：先 sync，不合适再 all_by_ids）。

        返回： (Diary, refresh_info)
        - Diary：数据库中的最终日记记录（可能被更新，也可能不变）
        - refresh_info：用于前端展示刷新过程与结果的结构化信息
        """
        result = await self.db.execute(select(Diary).where(Diary.id == diary_id))
        diary = result.scalar_one_or_none()
        if not diary:
            raise ValueError(f"Diary {diary_id} not found")

        result = await self.db.execute(select(Account).where(Account.id == diary.account_id))
        account = result.scalar_one_or_none()
        if not account:
            raise ValueError(f"Account {diary.account_id} not found")

        result = await self.db.execute(select(User).where(User.id == diary.user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError(f"User {diary.user_id} not found")

        refresh_info: dict[str, Any] = {
            "min_len_threshold": self._DETAIL_CONTENT_MIN_LEN,
            "used_sync": True,
            "sync_found": False,
            "sync_content_len": None,
            "sync_is_simple": None,
            "used_all_by_ids": False,
            "all_by_ids_returned": None,
            "detail_content_len": None,
            "detail_is_short": None,
            "detail_attempts": None,
            "updated": False,
            "update_source": None,
            "skipped_reason": None,
        }

        rdata = await self.fetch_nideriji_data_for_account(account)
        all_diaries: list[dict[str, Any]] = []
        for key in ("diaries", "diaries_paired"):
            value = rdata.get(key)
            if isinstance(value, list):
                all_diaries.extend([d for d in value if isinstance(d, dict)])

        matched = None
        for d in all_diaries:
            if d.get("id") == diary.nideriji_diary_id:
                matched = d
                break

        diary_data: dict[str, Any] | None = matched
        if diary_data:
            refresh_info["sync_found"] = True
            refresh_info["sync_content_len"] = self._content_len(diary_data.get("content"))
            refresh_info["sync_is_simple"] = bool(diary_data.get("is_simple") == 1)

        should_try_detail = False
        if diary_data and self._needs_detail_fetch(diary_data.get("content"), diary_data.get("is_simple")):
            should_try_detail = True
        if not diary_data:
            # sync 没找到该日记：视为“不合适”，直接尝试详情接口
            should_try_detail = True

        if should_try_detail:
            refresh_info["used_all_by_ids"] = True
            details_by_id = await self.fetch_nideriji_diaries_by_ids(
                auth_token=account.auth_token,
                diary_owner_userid=user.nideriji_userid,
                diary_ids=[diary.nideriji_diary_id],
            )
            detail = details_by_id.get(diary.nideriji_diary_id)
            if detail:
                refresh_info["all_by_ids_returned"] = True
                if diary_data:
                    diary_data = self._merge_diary_data(diary_data, detail)
                else:
                    diary_data = detail

                detail_content_len = self._content_len(diary_data.get("content"))
                refresh_info["detail_content_len"] = detail_content_len
                refresh_info["detail_is_short"] = detail_content_len < self._DETAIL_CONTENT_MIN_LEN

                await self._upsert_detail_fetch_state(
                    diary,
                    success=True,
                    is_short=detail_content_len < self._DETAIL_CONTENT_MIN_LEN,
                    content_len=detail_content_len,
                    error=None,
                )
            else:
                refresh_info["all_by_ids_returned"] = False
                await self._upsert_detail_fetch_state(
                    diary,
                    success=False,
                    is_short=False,
                    content_len=None,
                    error="详情接口未返回该日记",
                )

            # 尝试读取 attempts（用于前端展示）
            state_result = await self.db.execute(
                select(DiaryDetailFetch).where(DiaryDetailFetch.diary_id == diary.id)
            )
            state = state_result.scalar_one_or_none()
            if state:
                refresh_info["detail_attempts"] = state.attempts

        if diary_data:
            created_time = None
            if diary_data.get("createdtime"):
                created_time = datetime.fromtimestamp(diary_data["createdtime"])

            new_title = diary_data.get("title", "")
            new_content = (diary_data.get("content", "") or "").strip("\ufeff")
            new_weather = diary_data.get("weather", "")
            new_mood = diary_data.get("mood", "")
            new_mood_id = diary_data.get("mood_id")
            new_mood_color = diary_data.get("mood_color")
            new_space = diary_data.get("space", "")
            new_is_simple = diary_data.get("is_simple", 0)
            new_msg_count = diary_data.get("msg_count", 0)
            new_ts = diary_data.get("ts")

            changed = any(
                [
                    diary.title != new_title,
                    (diary.content or "") != new_content,
                    diary.created_time != created_time,
                    (diary.weather or "") != new_weather,
                    (diary.mood or "") != new_mood,
                    diary.mood_id != new_mood_id,
                    diary.mood_color != new_mood_color,
                    (diary.space or "") != new_space,
                    diary.is_simple != new_is_simple,
                    diary.msg_count != new_msg_count,
                    diary.ts != new_ts,
                ]
            )

            # 强制刷新也不允许“短内容”覆盖“完整内容”
            if (
                self._content_len(new_content) < self._DETAIL_CONTENT_MIN_LEN
                and self._content_len(diary.content) >= self._DETAIL_CONTENT_MIN_LEN
            ):
                refresh_info["updated"] = False
                refresh_info["update_source"] = None
                refresh_info["skipped_reason"] = "短内容不会覆盖数据库中已存在的完整内容"
                return diary, refresh_info

            if not changed:
                refresh_info["updated"] = False
                refresh_info["update_source"] = None
                refresh_info["skipped_reason"] = "内容未发生变化"
                return diary, refresh_info

            if diary.content != new_content or diary.title != new_title:
                history = DiaryHistory(
                    diary_id=diary.id,
                    nideriji_diary_id=diary.nideriji_diary_id,
                    title=diary.title,
                    content=diary.content,
                    weather=diary.weather,
                    mood=diary.mood,
                    ts=diary.ts,
                )
                self.db.add(history)

            diary.title = new_title
            diary.content = new_content
            diary.created_time = created_time
            diary.weather = new_weather
            diary.mood = new_mood
            diary.mood_id = new_mood_id
            diary.mood_color = new_mood_color
            diary.space = new_space
            diary.is_simple = new_is_simple
            diary.msg_count = new_msg_count
            diary.ts = new_ts

            # 判断本次更新来源（仅用于展示）
            if refresh_info["used_all_by_ids"] and refresh_info["all_by_ids_returned"]:
                refresh_info["update_source"] = "all_by_ids"
            elif refresh_info["sync_found"]:
                refresh_info["update_source"] = "sync"

            refresh_info["updated"] = True
        else:
            refresh_info["updated"] = False
            refresh_info["skipped_reason"] = "sync 未找到且详情接口也未返回该日记"

        return diary, refresh_info

    async def sync_account(self, account_id: int) -> dict:
        """同步单个账号的数据"""
        result = await self.db.execute(
            select(Account).where(Account.id == account_id)
        )
        account = result.scalar_one_or_none()
        if not account:
            raise ValueError(f"Account {account_id} not found")

        log = await self._start_sync_log(account_id)
        # 先提交“running”日志，便于前端实时显示“正在更新中”。
        await self.db.commit()

        try:
            rdata = await self.fetch_nideriji_data_for_account(account)

            await self._save_user_info(rdata['user_config'], account_id)

            # 注意：_save_diaries 的返回值是“本次新增日记数”，并非“当前总数”。
            # 仪表盘与同步日志展示需要的是“总数”，否则二次同步很容易显示为 0。
            main_user = await self.db.scalar(
                select(User).where(User.nideriji_userid == rdata["user_config"]["userid"])
            )

            if rdata['user_config'].get('paired_user_config'):
                await self._save_paired_user_info(
                    rdata['user_config']['paired_user_config'],
                    account_id
                )

            await self._save_diaries(
                rdata['diaries'],
                account_id,
                rdata['user_config']['userid'],
                account.auth_token,
            )

            if rdata.get('diaries_paired'):
                paired_user_id = rdata['user_config']['paired_user_config']['userid']
                await self._save_diaries(
                    rdata['diaries_paired'],
                    account_id,
                    paired_user_id,
                    account.auth_token,
                )

            diaries_count = 0
            paired_diaries_count = 0
            if main_user and main_user.id is not None:
                diaries_count, paired_diaries_count = await self._get_account_diary_totals(
                    account_id=account_id,
                    main_user_id=main_user.id,
                )

            await self._finish_sync_log(
                log,
                status='success',
                diaries_count=diaries_count,
                paired_diaries_count=paired_diaries_count,
                error_message=None,
            )
            await self.db.commit()

            return {
                'status': 'success',
                'diaries_count': diaries_count,
                'paired_diaries_count': paired_diaries_count
            }
        except Exception as e:
            await self._finish_sync_log(
                log,
                status='failed',
                diaries_count=0,
                paired_diaries_count=0,
                error_message=str(e),
            )
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

    async def _save_diaries(
        self,
        diaries: list[dict[str, Any]],
        account_id: int,
        user_nideriji_id: int,
        auth_token: str,
    ) -> int:
        """保存日记数据"""
        if not diaries:
            return 0

        result = await self.db.execute(
            select(User).where(User.nideriji_userid == user_nideriji_id)        
        )
        user = result.scalar_one_or_none()
        if not user:
            return 0

        # 预查当前批次的日记，避免循环里逐条查库，同时用于“已有完整内容则跳过详情请求”。
        diary_ids: list[int] = []
        for d in diaries:
            diary_id = d.get("id")
            if isinstance(diary_id, int):
                diary_ids.append(diary_id)

        existing_by_id: dict[int, Diary] = {}
        if diary_ids:
            existing_result = await self.db.execute(
                select(Diary).where(Diary.nideriji_diary_id.in_(diary_ids))
            )
            for diary in existing_result.scalars().all():
                existing_by_id[diary.nideriji_diary_id] = diary

        detail_state_by_diary_db_id = await self._get_detail_fetch_state_map(
            [d.id for d in existing_by_id.values() if d.id is not None]
        )

        need_detail_ids: list[int] = []
        for d in diaries:
            diary_id = d.get("id")
            if not isinstance(diary_id, int):
                continue

            if not self._needs_detail_fetch(d.get("content"), d.get("is_simple")):
                continue

            existing = existing_by_id.get(diary_id)
            if existing and self._content_len(existing.content) >= self._DETAIL_CONTENT_MIN_LEN:
                # 数据库已有完整内容：不再采集详情，也不允许被短内容覆盖。
                continue

            if existing:
                state = detail_state_by_diary_db_id.get(existing.id)
                if state and state.last_detail_success and state.last_detail_is_short:
                    # 该日记已请求过详情接口，但内容仍然过短：后续同步不再重复请求详情
                    continue

            need_detail_ids.append(diary_id)

        details_by_id: dict[int, dict[str, Any]] = {}
        if need_detail_ids:
            details_by_id = await self.fetch_nideriji_diaries_by_ids(
                auth_token=auth_token,
                diary_owner_userid=user_nideriji_id,
                diary_ids=need_detail_ids,
            )

        requested_detail_ids = set(need_detail_ids)

        count = 0
        for diary_data in diaries:
            diary_id = diary_data.get("id")
            if not isinstance(diary_id, int):
                continue

            if diary_id in details_by_id:
                diary_data = self._merge_diary_data(diary_data, details_by_id[diary_id])

            diary = existing_by_id.get(diary_id)

            created_time = None
            if diary_data.get('createdtime'):
                created_time = datetime.fromtimestamp(diary_data['createdtime'])

            if not diary:
                diary = Diary(
                    nideriji_diary_id=diary_id,
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
                existing_by_id[diary_id] = diary
                count += 1
            else:
                # 检查内容是否有变化
                new_content = diary_data.get('content', '') or ''
                new_title = diary_data.get('title', '')

                # 防止“短内容”覆盖“完整内容”（常见于 paired 日记只返回预览）。
                if (
                    self._content_len(new_content) < self._DETAIL_CONTENT_MIN_LEN
                    and self._content_len(diary.content) >= self._DETAIL_CONTENT_MIN_LEN
                ):
                    continue

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

            # 若本次对该日记发起过详情请求，则记录结果（用于后续跳过重复请求）
            if diary and diary_id in requested_detail_ids:
                if diary_id in details_by_id:
                    detail_content_len = self._content_len(diary_data.get("content"))
                    await self._upsert_detail_fetch_state(
                        diary,
                        success=True,
                        is_short=detail_content_len < self._DETAIL_CONTENT_MIN_LEN,
                        content_len=detail_content_len,
                        error=None,
                    )
                else:
                    await self._upsert_detail_fetch_state(
                        diary,
                        success=False,
                        is_short=False,
                        content_len=None,
                        error="详情接口未返回该日记",
                    )

        return count

    async def _start_sync_log(self, account_id: int) -> SyncLog:
        """创建一条“running”同步日志并返回（需要后续 finish 更新）。"""
        log = SyncLog(
            account_id=account_id,
            # SQLite 的 CURRENT_TIMESTAMP 默认是 UTC 但不带时区；这里明确写入 UTC，避免前端解析偏差。
            sync_time=datetime.now(timezone.utc),
            status='running',
            diaries_count=None,
            paired_diaries_count=None,
            error_message=None,
        )
        self.db.add(log)
        await self.db.flush()
        return log

    async def _finish_sync_log(
        self,
        log: SyncLog,
        *,
        status: str,
        diaries_count: int,
        paired_diaries_count: int,
        error_message: str | None,
    ) -> None:
        """更新同步日志为最终状态。"""
        log.status = status
        log.diaries_count = diaries_count
        log.paired_diaries_count = paired_diaries_count
        log.error_message = error_message

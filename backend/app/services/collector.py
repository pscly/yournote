"""数据采集服务

说明：
- 主同步接口：`https://nideriji.cn/api/v2/sync/`
- 当日记内容过短（通常是公开日记的“简略内容”）时，会额外调用
  `https://nideriji.cn/api/diary/all_by_ids/{userid}/` 再取一次完整内容。

采集策略：
- 若数据库里已存在“完整内容”，则不会重复请求详情，也不会用短内容覆盖长内容。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, cast

import httpx
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import (
    Account,
    Diary,
    DiaryDetailFetch,
    DiaryHistory,
    DiaryMsgCountEvent,
    PairedRelationship,
    SyncLog,
    User,
)
from ..utils.errors import safe_str
from .http_client import request_with_retry
from .image_cache import ImageCacheService

_ACCOUNT_SYNC_LOCKS: dict[int, asyncio.Lock] = {}
logger = logging.getLogger(__name__)


def _retry_suffix(exc: BaseException) -> str:
    attempts = getattr(exc, "yournote_attempts", None)
    if attempts is None:
        attempts_i = 0
    else:
        try:
            attempts_i = int(attempts)
        except Exception:
            attempts_i = 0
    return f"（已重试 {attempts_i} 次）" if attempts_i > 1 else ""


class CollectorService:
    """数据采集服务"""

    _DETAIL_CONTENT_MIN_LEN = 100
    _DETAIL_FETCH_BATCH_SIZE = 50
    _REQUEST_TIMEOUT_SECONDS = 15
    _LOGIN_TIMEOUT_SECONDS = 15

    def __init__(self, db: AsyncSession):
        self.db = db

    def _nideriji_origin(self) -> str:
        base = (
            (getattr(settings, "nideriji_api_base_url", None) or "https://nideriji.cn")
            .strip()
            .rstrip("/")
        )
        return base or "https://nideriji.cn"

    def _build_headers(self, auth_token: str) -> dict[str, str]:
        origin = self._nideriji_origin()
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            ),
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "auth": auth_token,
            "origin": origin,
            "referer": f"{origin}/w/",
        }

    def _build_login_headers(self) -> dict[str, str]:
        # 登录接口是传统表单提交，保持最小必要 header 即可。
        origin = self._nideriji_origin()
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            ),
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "origin": origin,
            "referer": f"{origin}/w/login",
        }

    async def login_nideriji(self, email: str, password: str) -> str:
        """使用账号密码登录 nideriji，返回可直接用于后续请求的 auth_token。

        返回形如：`token <jwt>`
        """
        origin = self._nideriji_origin()
        url = f"{origin}/api/login/"
        payload = {"email": email, "password": password}
        async with httpx.AsyncClient(
            timeout=self._LOGIN_TIMEOUT_SECONDS,
            trust_env=bool(getattr(settings, "nideriji_http_trust_env", True)),
        ) as client:
            resp = await request_with_retry(
                client=client,
                method="POST",
                url=url,
                data=payload,
                headers=self._build_login_headers(),
                max_attempts=int(
                    getattr(settings, "nideriji_http_max_attempts", 3) or 3
                ),
                backoff_seconds=float(
                    getattr(settings, "nideriji_http_retry_backoff_seconds", 0.5) or 0.5
                ),
                max_backoff_seconds=float(
                    getattr(settings, "nideriji_http_retry_max_backoff_seconds", 5.0)
                    or 5.0
                ),
                jitter_ratio=float(
                    getattr(settings, "nideriji_http_retry_jitter_ratio", 0.1) or 0.1
                ),
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

    def _to_utc_datetime(self, value: Any) -> datetime | None:
        """把上游的 epoch 时间戳统一转换为 UTC 时间（用 naive datetime 表示 UTC）。"""
        try:
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
            # SQLite 通常会丢失 tzinfo；前端也会把“无时区字符串”按 UTC 处理。
            # 因此这里统一存成“naive 但代表 UTC”的 datetime，避免每次同步都因 tzinfo
            # 差异导致误判为“字段变更”。（尤其是 refresh_diary 会写入历史记录）
            return dt.replace(tzinfo=None)
        except Exception:
            return None

    def _needs_detail_fetch(self, content: str | None, is_simple: Any) -> bool:
        if is_simple == 1:
            return True
        return self._content_len(content) < self._DETAIL_CONTENT_MIN_LEN

    def _normalize_msg_count(self, value: Any) -> int:
        try:
            if value is None:
                return 0
            if isinstance(value, bool):
                return int(value)
            n = int(value)
            return n if n >= 0 else 0
        except Exception:
            return 0

    async def _cas_update_diary_msg_count(
        self,
        *,
        diary: Diary,
        account_id: int,
        new_msg_count: int,
        source: str,
        sync_log_id: int | None,
    ) -> bool:
        diary_id = getattr(diary, "id", None)
        if not isinstance(diary_id, int) or diary_id <= 0:
            return False

        old_is_null = getattr(diary, "msg_count", None) is None
        old_msg_count = self._normalize_msg_count(getattr(diary, "msg_count", None))
        new_msg_count_norm = self._normalize_msg_count(new_msg_count)

        if (not old_is_null) and new_msg_count_norm == old_msg_count:
            return False

        where_msg_count = Diary.msg_count == old_msg_count
        if old_msg_count == 0:
            where_msg_count = or_(Diary.msg_count == 0, Diary.msg_count.is_(None))

        stmt = (
            update(Diary)
            .where(
                Diary.id == diary_id,
                Diary.account_id == account_id,
                where_msg_count,
            )
            .values(msg_count=new_msg_count_norm)
            .execution_options(synchronize_session="fetch")
        )
        result = await self.db.execute(stmt)
        rowcount = int(getattr(result, "rowcount", 0) or 0)
        if rowcount != 1:
            return False

        delta = new_msg_count_norm - old_msg_count
        if delta > 0:
            self.db.add(
                DiaryMsgCountEvent(
                    account_id=account_id,
                    diary_id=diary_id,
                    sync_log_id=sync_log_id,
                    old_msg_count=old_msg_count,
                    new_msg_count=new_msg_count_norm,
                    delta=delta,
                    source=source,
                )
            )

        return True

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

    async def _get_detail_fetch_state_map(
        self, diary_db_ids: list[int]
    ) -> dict[int, DiaryDetailFetch]:
        if not diary_db_ids:
            return {}
        result = await self.db.execute(
            select(DiaryDetailFetch).where(DiaryDetailFetch.diary_id.in_(diary_db_ids))
        )
        mapping: dict[int, DiaryDetailFetch] = {}
        for row in result.scalars().all():
            did = getattr(row, "diary_id", None)
            if isinstance(did, int):
                mapping[did] = row
        return mapping

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

        setattr(state, "nideriji_diary_id", diary.nideriji_diary_id)
        setattr(state, "last_detail_at", now)
        setattr(state, "last_detail_success", bool(success))
        setattr(state, "last_detail_is_short", bool(is_short) if success else False)
        setattr(state, "last_detail_content_len", content_len)
        setattr(state, "last_detail_error", error)
        attempts = int(getattr(state, "attempts", 0) or 0)
        setattr(state, "attempts", attempts + 1)

    async def fetch_nideriji_data(self, auth_token: str) -> dict[str, Any]:
        """从 nideriji API 获取数据"""
        origin = self._nideriji_origin()
        url = f"{origin}/api/v2/sync/"
        headers = self._build_headers(auth_token)
        async with httpx.AsyncClient(
            timeout=self._REQUEST_TIMEOUT_SECONDS,
            trust_env=bool(getattr(settings, "nideriji_http_trust_env", True)),
        ) as client:
            response = await request_with_retry(
                client=client,
                method="POST",
                url=url,
                headers=headers,
                max_attempts=int(
                    getattr(settings, "nideriji_http_max_attempts", 3) or 3
                ),
                backoff_seconds=float(
                    getattr(settings, "nideriji_http_retry_backoff_seconds", 0.5) or 0.5
                ),
                max_backoff_seconds=float(
                    getattr(settings, "nideriji_http_retry_max_backoff_seconds", 5.0)
                    or 5.0
                ),
                jitter_ratio=float(
                    getattr(settings, "nideriji_http_retry_jitter_ratio", 0.1) or 0.1
                ),
            )
        response.raise_for_status()
        return response.json()

    async def fetch_nideriji_data_for_account(self, account: Account) -> dict[str, Any]:
        """按账号获取 sync 数据，并在 token 失效时自动重新登录刷新 token。

        说明：
        - 仅在收到 401/403 且本地已保存 email + login_password 时触发一次重登
        - 成功后会把新 token 写回 account.auth_token（由调用方决定何时 commit）
        """
        try:
            auth_token = getattr(account, "auth_token", "")
            if not isinstance(auth_token, str):
                auth_token = str(auth_token)
            return await self.fetch_nideriji_data(auth_token)
        except httpx.HTTPStatusError as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            email_val = getattr(account, "email", None)
            email: str | None = email_val if isinstance(email_val, str) else None
            password_val = getattr(account, "login_password", None)
            login_password: str | None = (
                password_val if isinstance(password_val, str) else None
            )
            can_relogin = (
                isinstance(status_code, int)
                and status_code in (401, 403)
                and isinstance(email, str)
                and email.strip()
                and isinstance(login_password, str)
                and login_password.strip()
            )
            if not can_relogin:
                raise

            if not email or not login_password:
                raise

            new_token = await self.login_nideriji(email, login_password)
            setattr(account, "auth_token", new_token)
            await self.db.flush()
            return await self.fetch_nideriji_data(new_token)

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

        origin = self._nideriji_origin()
        url = f"{origin}/api/diary/all_by_ids/{diary_owner_userid}/"
        headers = self._build_headers(auth_token)

        # 接口支持一次传多个 id（字符串），这里做分批，避免过长的 form body。
        results: dict[int, dict[str, Any]] = {}
        async with httpx.AsyncClient(
            timeout=self._REQUEST_TIMEOUT_SECONDS,
            trust_env=bool(getattr(settings, "nideriji_http_trust_env", True)),
        ) as client:
            for start in range(0, len(diary_ids), self._DETAIL_FETCH_BATCH_SIZE):
                batch = diary_ids[start : start + self._DETAIL_FETCH_BATCH_SIZE]
                payload = {"diary_ids": ",".join(str(diary_id) for diary_id in batch)}
                resp = await request_with_retry(
                    client=client,
                    method="POST",
                    url=url,
                    data=payload,
                    headers=headers,
                    max_attempts=int(
                        getattr(settings, "nideriji_http_max_attempts", 3) or 3
                    ),
                    backoff_seconds=float(
                        getattr(settings, "nideriji_http_retry_backoff_seconds", 0.5)
                        or 0.5
                    ),
                    max_backoff_seconds=float(
                        getattr(
                            settings, "nideriji_http_retry_max_backoff_seconds", 5.0
                        )
                        or 5.0
                    ),
                    jitter_ratio=float(
                        getattr(settings, "nideriji_http_retry_jitter_ratio", 0.1)
                        or 0.1
                    ),
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

    def _merge_diary_data(
        self, base: dict[str, Any], detail: dict[str, Any]
    ) -> dict[str, Any]:
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
        diary_any: Any = cast(Any, diary)

        result = await self.db.execute(
            select(Account).where(Account.id == diary.account_id)
        )
        account = result.scalar_one_or_none()
        if not account:
            raise ValueError(f"Account {diary.account_id} not found")
        account_any: Any = cast(Any, account)

        result = await self.db.execute(select(User).where(User.id == diary.user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError(f"User {diary.user_id} not found")
        user_any: Any = cast(Any, user)

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

        rdata = await self.fetch_nideriji_data_for_account(account_any)
        all_diaries: list[dict[str, Any]] = []
        for key in ("diaries", "diaries_paired"):
            value = rdata.get(key)
            if isinstance(value, list):
                all_diaries.extend([d for d in value if isinstance(d, dict)])

        matched = None
        nideriji_diary_id = int(getattr(diary_any, "nideriji_diary_id", 0) or 0)
        for d in all_diaries:
            if d.get("id") == nideriji_diary_id:
                matched = d
                break

        diary_data: dict[str, Any] | None = matched
        if diary_data:
            refresh_info["sync_found"] = True
            refresh_info["sync_content_len"] = self._content_len(
                diary_data.get("content")
            )
            refresh_info["sync_is_simple"] = bool(diary_data.get("is_simple") == 1)

        should_try_detail = False
        if diary_data and self._needs_detail_fetch(
            diary_data.get("content"), diary_data.get("is_simple")
        ):
            should_try_detail = True
        if not diary_data:
            # sync 没找到该日记：视为“不合适”，直接尝试详情接口
            should_try_detail = True

        if should_try_detail:
            refresh_info["used_all_by_ids"] = True
            details_by_id = await self.fetch_nideriji_diaries_by_ids(
                auth_token=str(getattr(account_any, "auth_token", "") or ""),
                diary_owner_userid=int(getattr(user_any, "nideriji_userid", 0) or 0),
                diary_ids=[nideriji_diary_id],
            )
            detail = details_by_id.get(nideriji_diary_id)
            if detail:
                refresh_info["all_by_ids_returned"] = True
                if diary_data:
                    diary_data = self._merge_diary_data(diary_data, detail)
                else:
                    diary_data = detail

                detail_content_len = self._content_len(diary_data.get("content"))
                refresh_info["detail_content_len"] = detail_content_len
                refresh_info["detail_is_short"] = (
                    detail_content_len < self._DETAIL_CONTENT_MIN_LEN
                )

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
                created_time = self._to_utc_datetime(diary_data["createdtime"])

            new_title = diary_data.get("title", "")
            new_content = (diary_data.get("content", "") or "").strip("\ufeff")
            new_weather = diary_data.get("weather", "")
            new_mood = diary_data.get("mood", "")
            new_mood_id = diary_data.get("mood_id")
            new_mood_color = diary_data.get("mood_color")
            new_space = diary_data.get("space", "")
            new_is_simple = diary_data.get("is_simple", 0)
            new_msg_count = self._normalize_msg_count(diary_data.get("msg_count", 0))
            new_ts = diary_data.get("ts")

            msg_updated = await self._cas_update_diary_msg_count(
                diary=diary_any,
                account_id=int(getattr(diary_any, "account_id", 0) or 0),
                new_msg_count=new_msg_count,
                source="refresh",
                sync_log_id=None,
            )

            # 强制刷新也不允许“短内容”覆盖“完整内容”
            if (
                self._content_len(new_content) < self._DETAIL_CONTENT_MIN_LEN
                and self._content_len(getattr(diary_any, "content", None))
                >= self._DETAIL_CONTENT_MIN_LEN
            ):
                if msg_updated:
                    refresh_info["updated"] = True
                    if (
                        refresh_info["used_all_by_ids"]
                        and refresh_info["all_by_ids_returned"]
                    ):
                        refresh_info["update_source"] = "all_by_ids"
                    elif refresh_info["sync_found"]:
                        refresh_info["update_source"] = "sync"
                    refresh_info["skipped_reason"] = (
                        "短内容不会覆盖数据库中已存在的完整内容（已仅更新留言数）"
                    )
                else:
                    refresh_info["updated"] = False
                    refresh_info["update_source"] = None
                    refresh_info["skipped_reason"] = (
                        "短内容不会覆盖数据库中已存在的完整内容"
                    )
                return diary, refresh_info

            changed_non_msg = any(
                [
                    getattr(diary_any, "title", None) != new_title,
                    (getattr(diary_any, "content", "") or "") != new_content,
                    getattr(diary_any, "created_time", None) != created_time,
                    (getattr(diary_any, "weather", "") or "") != new_weather,
                    (getattr(diary_any, "mood", "") or "") != new_mood,
                    getattr(diary_any, "mood_id", None) != new_mood_id,
                    getattr(diary_any, "mood_color", None) != new_mood_color,
                    (getattr(diary_any, "space", "") or "") != new_space,
                    getattr(diary_any, "is_simple", None) != new_is_simple,
                    getattr(diary_any, "ts", None) != new_ts,
                ]
            )

            if not changed_non_msg:
                if msg_updated:
                    refresh_info["updated"] = True
                    if (
                        refresh_info["used_all_by_ids"]
                        and refresh_info["all_by_ids_returned"]
                    ):
                        refresh_info["update_source"] = "all_by_ids"
                    elif refresh_info["sync_found"]:
                        refresh_info["update_source"] = "sync"
                    refresh_info["skipped_reason"] = "仅留言数发生变化"
                else:
                    refresh_info["updated"] = False
                    refresh_info["update_source"] = None
                    refresh_info["skipped_reason"] = "内容未发生变化"
                return diary, refresh_info

            old_content = getattr(diary_any, "content", None)
            old_title = getattr(diary_any, "title", None)
            old_content_text = old_content or ""
            old_title_text = old_title or ""

            if old_content_text != new_content or old_title_text != new_title:
                history = DiaryHistory(
                    diary_id=int(getattr(diary_any, "id", 0) or 0),
                    nideriji_diary_id=int(
                        getattr(diary_any, "nideriji_diary_id", 0) or 0
                    ),
                    title=old_title,
                    content=old_content,
                    weather=getattr(diary_any, "weather", None),
                    mood=getattr(diary_any, "mood", None),
                    ts=getattr(diary_any, "ts", None),
                )
                self.db.add(history)

            setattr(diary_any, "title", new_title)
            setattr(diary_any, "content", new_content)
            setattr(diary_any, "created_time", created_time)
            setattr(diary_any, "weather", new_weather)
            setattr(diary_any, "mood", new_mood)
            setattr(diary_any, "mood_id", new_mood_id)
            setattr(diary_any, "mood_color", new_mood_color)
            setattr(diary_any, "space", new_space)
            setattr(diary_any, "is_simple", new_is_simple)
            setattr(diary_any, "ts", new_ts)

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

    async def sync_account(self, account_id: int) -> dict[str, Any]:
        """同步单个账号的数据"""
        lock = _ACCOUNT_SYNC_LOCKS.get(account_id)
        if lock is None:
            lock = asyncio.Lock()
            _ACCOUNT_SYNC_LOCKS[account_id] = lock

        async with lock:
            result = await self.db.execute(
                select(Account).where(Account.id == account_id)
            )
            account = result.scalar_one_or_none()
            if not account:
                raise ValueError(f"Account {account_id} not found")

            log = await self._start_sync_log(account_id)
            # 先提交“running”日志，便于前端实时显示“正在更新中”。
            await self.db.commit()
            sync_log_id = getattr(log, "id", None)
            sync_log_id_int: int | None = (
                sync_log_id if isinstance(sync_log_id, int) else None
            )

            try:
                rdata = await self.fetch_nideriji_data_for_account(account)

                await self._save_user_info(rdata["user_config"], account_id)

                # 注意：_save_diaries 的返回值是“本次新增日记数”，并非“当前总数”。
                # 仪表盘与同步日志展示需要的是“总数”，否则二次同步很容易显示为 0。
                main_user = await self.db.scalar(
                    select(User).where(
                        User.nideriji_userid == rdata["user_config"]["userid"]
                    )
                )

                if rdata["user_config"].get("paired_user_config"):
                    await self._save_paired_user_info(
                        rdata["user_config"]["paired_user_config"], account_id
                    )

                _, prefetch_diary_ids_main = await self._save_diaries(
                    rdata["diaries"],
                    account_id,
                    rdata["user_config"]["userid"],
                    str(getattr(account, "auth_token", "") or ""),
                    sync_log_id=sync_log_id_int,
                )

                prefetch_diary_ids: list[int] = list(prefetch_diary_ids_main or [])
                if rdata.get("diaries_paired"):
                    paired_user_id = rdata["user_config"]["paired_user_config"][
                        "userid"
                    ]
                    _, prefetch_diary_ids_paired = await self._save_diaries(
                        rdata["diaries_paired"],
                        account_id,
                        paired_user_id,
                        str(getattr(account, "auth_token", "") or ""),
                        sync_log_id=sync_log_id_int,
                    )
                    prefetch_diary_ids.extend(list(prefetch_diary_ids_paired or []))

                diaries_count = 0
                paired_diaries_count = 0
                main_user_id = getattr(main_user, "id", None) if main_user else None
                if isinstance(main_user_id, int) and main_user_id > 0:
                    (
                        diaries_count,
                        paired_diaries_count,
                    ) = await self._get_account_diary_totals(
                        account_id=account_id,
                        main_user_id=main_user_id,
                    )

                await self._finish_sync_log(
                    log,
                    status="success",
                    diaries_count=diaries_count,
                    paired_diaries_count=paired_diaries_count,
                    error_message=None,
                )
                await self.db.commit()

                # 同步成功后后台预拉取图片（不阻塞接口返回）
                if (
                    bool(settings.image_cache_enabled)
                    and bool(settings.image_cache_prefetch_on_sync)
                    and prefetch_diary_ids
                ):
                    self._schedule_prefetch_images(
                        account_id=account_id, diary_ids=prefetch_diary_ids
                    )

                return {
                    "status": "success",
                    "diaries_count": diaries_count,
                    "paired_diaries_count": paired_diaries_count,
                }
            except Exception as e:
                # 同步日志是“给人看的”，错误信息尽量短且可读（避免把内部堆栈写进去）
                if isinstance(e, httpx.TimeoutException):
                    msg = f"同步超时（上游无响应{_retry_suffix(e)}）"
                elif isinstance(e, httpx.RequestError):
                    msg = f"网络异常{_retry_suffix(e)}: {safe_str(e, max_len=400)}"
                else:
                    msg = safe_str(e, max_len=400)
                await self._finish_sync_log(
                    log,
                    status="failed",
                    diaries_count=0,
                    paired_diaries_count=0,
                    error_message=msg,
                )
                await self.db.commit()
                raise

    async def _save_user_info(
        self, user_config: dict[str, Any], account_id: int
    ) -> User:
        """保存用户信息"""
        result = await self.db.execute(
            select(User).where(User.nideriji_userid == user_config["userid"])
        )
        user = result.scalar_one_or_none()

        last_login_time = None
        if user_config.get("last_login_time"):
            last_login_time = self._to_utc_datetime(user_config["last_login_time"])

        if user:
            user_any: Any = cast(Any, user)
            setattr(user_any, "name", user_config.get("name"))
            setattr(user_any, "description", user_config.get("description"))
            setattr(user_any, "role", user_config.get("role"))
            setattr(user_any, "avatar", user_config.get("avatar"))
            setattr(user_any, "diary_count", user_config.get("diary_count", 0))
            setattr(user_any, "word_count", user_config.get("word_count", 0))
            setattr(user_any, "image_count", user_config.get("image_count", 0))
            setattr(user_any, "last_login_time", last_login_time)
        else:
            user = User(
                nideriji_userid=user_config["userid"],
                name=user_config.get("name"),
                description=user_config.get("description"),
                role=user_config.get("role"),
                avatar=user_config.get("avatar"),
                diary_count=user_config.get("diary_count", 0),
                word_count=user_config.get("word_count", 0),
                image_count=user_config.get("image_count", 0),
                last_login_time=last_login_time,
            )
            self.db.add(user)

        await self.db.flush()
        return user

    async def _save_paired_user_info(
        self, paired_config: dict[str, Any], account_id: int
    ) -> None:
        """保存配对用户信息"""
        paired_user = await self._save_user_info(
            {"userid": paired_config["userid"], **paired_config}, account_id
        )

        result = await self.db.execute(
            select(User).where(
                User.nideriji_userid
                == (
                    await self.db.execute(
                        select(Account.nideriji_userid).where(Account.id == account_id)
                    )
                ).scalar()
            )
        )
        main_user = result.scalar_one_or_none()

        if main_user and paired_user:
            result = await self.db.execute(
                select(PairedRelationship).where(
                    PairedRelationship.account_id == account_id,
                    PairedRelationship.paired_user_id == paired_user.id,
                )
            )
            relationship = result.scalar_one_or_none()

            if not relationship:
                paired_time = None
                if paired_config.get("paired_time"):
                    paired_time = self._to_utc_datetime(paired_config["paired_time"])

                relationship = PairedRelationship(
                    account_id=account_id,
                    user_id=main_user.id,
                    paired_user_id=paired_user.id,
                    paired_time=paired_time,
                    is_active=True,
                )
                self.db.add(relationship)

    async def _save_diaries(
        self,
        diaries: list[dict[str, Any]],
        account_id: int,
        user_nideriji_id: int,
        auth_token: str,
        *,
        sync_log_id: int | None = None,
    ) -> tuple[int, list[int]]:
        """保存日记数据。

        返回：
        - 本次新增日记数
        - 需要图片预拉取的 diary_id 列表（仅包含本次新增/更新且正文含 `[图13]` 的记录）
        """
        if not diaries:
            return 0, []

        result = await self.db.execute(
            select(User).where(User.nideriji_userid == user_nideriji_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return 0, []

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
                diary_any: Any = cast(Any, diary)
                nideriji_diary_id = int(getattr(diary_any, "nideriji_diary_id", 0) or 0)
                if nideriji_diary_id > 0:
                    existing_by_id[nideriji_diary_id] = diary

        diary_db_ids: list[int] = []
        for d in existing_by_id.values():
            d_any: Any = cast(Any, d)
            did = getattr(d_any, "id", None)
            if isinstance(did, int) and did > 0:
                diary_db_ids.append(did)

        detail_state_by_diary_db_id = await self._get_detail_fetch_state_map(
            diary_db_ids
        )

        need_detail_ids: list[int] = []
        for d in diaries:
            diary_id = d.get("id")
            if not isinstance(diary_id, int):
                continue

            if not self._needs_detail_fetch(d.get("content"), d.get("is_simple")):
                continue

            existing = existing_by_id.get(diary_id)
            if (
                existing
                and self._content_len(getattr(cast(Any, existing), "content", None))
                >= self._DETAIL_CONTENT_MIN_LEN
            ):
                # 数据库已有完整内容：不再采集详情，也不允许被短内容覆盖。
                continue

            if existing:
                existing_any: Any = cast(Any, existing)
                existing_db_id = getattr(existing_any, "id", None)
                existing_db_id_int = (
                    existing_db_id if isinstance(existing_db_id, int) else 0
                )
                state = (
                    detail_state_by_diary_db_id.get(existing_db_id_int)
                    if existing_db_id_int > 0
                    else None
                )
                if state:
                    state_any: Any = cast(Any, state)
                    if bool(getattr(state_any, "last_detail_success", False)) and bool(
                        getattr(state_any, "last_detail_is_short", False)
                    ):
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
        touched_for_prefetch: list[Diary] = []
        for diary_data in diaries:
            diary_id = diary_data.get("id")
            if not isinstance(diary_id, int):
                continue

            if diary_id in details_by_id:
                diary_data = self._merge_diary_data(diary_data, details_by_id[diary_id])

            diary = existing_by_id.get(diary_id)

            created_time = None
            if diary_data.get("createdtime"):
                created_time = self._to_utc_datetime(diary_data["createdtime"])

            if not diary:
                diary = Diary(
                    nideriji_diary_id=diary_id,
                    user_id=user.id,
                    account_id=account_id,
                    title=diary_data.get("title", ""),
                    content=diary_data.get("content", ""),
                    created_date=datetime.strptime(
                        diary_data["createddate"], "%Y-%m-%d"
                    ).date(),
                    created_time=created_time,
                    weather=diary_data.get("weather", ""),
                    mood=diary_data.get("mood", ""),
                    mood_id=diary_data.get("mood_id"),
                    mood_color=diary_data.get("mood_color"),
                    space=diary_data.get("space", ""),
                    is_simple=diary_data.get("is_simple", 0),
                    msg_count=self._normalize_msg_count(diary_data.get("msg_count", 0)),
                    ts=diary_data.get("ts"),
                )
                self.db.add(diary)
                existing_by_id[diary_id] = diary
                count += 1
                if ImageCacheService.extract_image_ids(diary.content):
                    touched_for_prefetch.append(diary)
            else:
                # 检查内容是否有变化
                new_content = diary_data.get("content", "") or ""
                new_title = diary_data.get("title", "")
                new_msg_count = self._normalize_msg_count(
                    diary_data.get("msg_count", 0)
                )

                await self._cas_update_diary_msg_count(
                    diary=diary,
                    account_id=account_id,
                    new_msg_count=new_msg_count,
                    source="sync",
                    sync_log_id=sync_log_id,
                )

                diary_any: Any = cast(Any, diary)
                db_content = getattr(diary_any, "content", None)
                db_title = getattr(diary_any, "title", None)
                db_content_text = db_content or ""
                db_title_text = db_title or ""

                # 防止“短内容”覆盖“完整内容”（常见于 paired 日记只返回预览）。
                if (
                    self._content_len(new_content) < self._DETAIL_CONTENT_MIN_LEN
                    and self._content_len(db_content_text)
                    >= self._DETAIL_CONTENT_MIN_LEN
                ):
                    continue

                if db_content_text != new_content or db_title_text != new_title:
                    # 保存历史记录
                    history = DiaryHistory(
                        diary_id=int(getattr(diary_any, "id", 0) or 0),
                        nideriji_diary_id=int(
                            getattr(diary_any, "nideriji_diary_id", 0) or 0
                        ),
                        title=db_title,
                        content=db_content,
                        weather=getattr(diary_any, "weather", None),
                        mood=getattr(diary_any, "mood", None),
                        ts=getattr(diary_any, "ts", None),
                    )
                    self.db.add(history)
                    # 更新日记
                    setattr(diary_any, "title", new_title)
                    setattr(diary_any, "content", new_content)
                    setattr(diary_any, "weather", diary_data.get("weather", ""))
                    setattr(diary_any, "mood", diary_data.get("mood", ""))
                    setattr(diary_any, "ts", diary_data.get("ts"))
                    if ImageCacheService.extract_image_ids(new_content):
                        touched_for_prefetch.append(diary)

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

        # 确保新建记录拿到自增 id，便于后台预拉取任务定位
        await self.db.flush()

        prefetch_ids: list[int] = []
        seen_prefetch: set[int] = set()
        for d in touched_for_prefetch:
            did = getattr(d, "id", None)
            if isinstance(did, int) and did > 0 and did not in seen_prefetch:
                seen_prefetch.add(did)
                prefetch_ids.append(did)

        return count, prefetch_ids

    def _schedule_prefetch_images(
        self, *, account_id: int, diary_ids: list[int]
    ) -> None:
        """在后台预拉取图片（进程内异步任务，不阻塞同步 API）。"""
        if not diary_ids:
            return

        # 去重 + 限制最多处理多少条记录（防止一次同步触发过量预取）
        uniq: list[int] = []
        seen: set[int] = set()
        for did in diary_ids:
            if not isinstance(did, int) or did <= 0:
                continue
            if did in seen:
                continue
            seen.add(did)
            uniq.append(did)

        if not uniq:
            return

        max_images = int(settings.image_cache_prefetch_max_images_per_sync or 0) or 200

        async def _run() -> None:
            # 注意：不能复用当前请求的 db session（请求结束会关闭），这里重新开 session
            from ..database import AsyncSessionLocal

            try:
                async with AsyncSessionLocal() as session:
                    account = await session.scalar(
                        select(Account).where(Account.id == account_id)
                    )
                    if (
                        not account
                        or not isinstance(getattr(account, "auth_token", None), str)
                        or not account.auth_token.strip()
                    ):
                        return

                    account_any: Any = cast(Any, account)
                    auth_token = str(getattr(account_any, "auth_token", "") or "")

                    # 读取本次需要预拉取的记录正文与 nideriji_userid（用于图片接口路径）
                    rows = (
                        await session.execute(
                            select(Diary.id, Diary.content, User.nideriji_userid)
                            .join(User, Diary.user_id == User.id)
                            .where(Diary.account_id == account_id, Diary.id.in_(uniq))
                        )
                    ).all()

                    service = ImageCacheService(session)

                    # 汇总待拉取的图片（去重），并限制数量
                    todo: list[tuple[int, int]] = []
                    seen_key: set[tuple[int, int]] = set()
                    for _diary_id, content, nideriji_userid in rows:
                        if not isinstance(nideriji_userid, int) or nideriji_userid <= 0:
                            continue
                        for image_id in service.extract_image_ids(content):
                            key = (nideriji_userid, image_id)
                            if key in seen_key:
                                continue
                            seen_key.add(key)
                            todo.append(key)
                            if len(todo) >= max_images:
                                break
                        if len(todo) >= max_images:
                            break

                    if not todo:
                        return

                    timeout = float(settings.image_cache_timeout_seconds or 20)
                    async with httpx.AsyncClient(timeout=timeout) as client:
                        for nideriji_userid, image_id in todo:
                            await service.ensure_cached(
                                auth_token=auth_token,
                                nideriji_userid=nideriji_userid,
                                image_id=image_id,
                                client=client,
                            )

                    await session.commit()
            except Exception:
                logger.exception("[IMAGE_PREFETCH] Failed account_id=%s", account_id)

        task = asyncio.create_task(_run())

        def _on_done(t: asyncio.Task[None]) -> None:
            try:
                t.result()
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception(
                    "[IMAGE_PREFETCH] Task error account_id=%s", account_id
                )

        task.add_done_callback(_on_done)

    async def _start_sync_log(self, account_id: int) -> SyncLog:
        """创建一条“running”同步日志并返回（需要后续 finish 更新）。"""
        log = SyncLog(
            account_id=account_id,
            # SQLite 的 CURRENT_TIMESTAMP 默认是 UTC 但不带时区；这里明确写入 UTC，避免前端解析偏差。
            sync_time=datetime.now(timezone.utc),
            status="running",
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
        log_any: Any = cast(Any, log)
        setattr(log_any, "status", status)
        setattr(log_any, "diaries_count", diaries_count)
        setattr(log_any, "paired_diaries_count", paired_diaries_count)
        setattr(log_any, "error_message", error_message)

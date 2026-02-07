"""发布日记服务

说明：
- 该模块只负责“向 nideriji 写入/更新日记”这一件事。
- 为避免和采集逻辑混在一起，这里不复用 Diary 表，也不触发同步。
- 当账号 token 失效（401/403）且本地保存了账号密码时，会自动登录刷新 token，
  然后重试一次发布。
"""

from __future__ import annotations

from typing import Any

import httpx

from ..config import settings
from ..models import Account
from .collector import CollectorService
from .http_client import request_with_retry


class DiaryPublisherService:
    _REQUEST_TIMEOUT_SECONDS = 15

    def __init__(self, collector: CollectorService):
        self.collector = collector

    def _nideriji_origin(self) -> str:
        base = (getattr(settings, "nideriji_api_base_url", None) or "https://nideriji.cn").strip().rstrip("/")
        return base or "https://nideriji.cn"

    def _build_headers(self, auth_token: str) -> dict[str, str]:
        origin = self._nideriji_origin()
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36"
            ),
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "auth": auth_token,
            "origin": origin,
            "referer": f"{origin}/w/write",
        }

    async def write_diary(self, *, auth_token: str, date: str, content: str) -> dict[str, Any]:
        """直接用 token 写入/更新日记（不落库、不做 token 刷新）。"""
        origin = self._nideriji_origin()
        url = f"{origin}/api/write/"
        payload = {"content": content, "date": date}
        async with httpx.AsyncClient(
            timeout=self._REQUEST_TIMEOUT_SECONDS,
            trust_env=bool(getattr(settings, "nideriji_http_trust_env", True)),
        ) as client:
            resp = await request_with_retry(
                client=client,
                method="POST",
                url=url,
                data=payload,
                headers=self._build_headers(auth_token),
                max_attempts=int(getattr(settings, "nideriji_http_max_attempts", 3) or 3),
                backoff_seconds=float(getattr(settings, "nideriji_http_retry_backoff_seconds", 0.5) or 0.5),
                max_backoff_seconds=float(
                    getattr(settings, "nideriji_http_retry_max_backoff_seconds", 5.0) or 5.0
                ),
                jitter_ratio=float(getattr(settings, "nideriji_http_retry_jitter_ratio", 0.1) or 0.1),
            )
        resp.raise_for_status()
        data: Any = resp.json()
        if not isinstance(data, dict):
            raise ValueError("发布接口返回非 JSON 对象")
        return data

    async def write_diary_for_account(self, *, account: Account, date: str, content: str) -> dict[str, Any]:
        """按账号发布日记，必要时自动刷新 token 并重试一次。"""
        try:
            return await self.write_diary(auth_token=account.auth_token, date=date, content=content)
        except httpx.HTTPStatusError as e:
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

            # token 可能已失效：自动重新登录刷新 token，然后重试一次 write
            new_token = await self.collector.login_nideriji(account.email, account.login_password)
            account.auth_token = new_token
            await self.collector.db.flush()
            return await self.write_diary(auth_token=account.auth_token, date=date, content=content)

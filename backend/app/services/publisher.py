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

from ..models import Account
from .collector import CollectorService


class DiaryPublisherService:
    _REQUEST_TIMEOUT_SECONDS = 15

    def __init__(self, collector: CollectorService):
        self.collector = collector

    def _build_headers(self, auth_token: str) -> dict[str, str]:
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36"
            ),
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "auth": auth_token,
            "origin": "https://nideriji.cn",
            "referer": "https://nideriji.cn/w/write",
        }

    async def write_diary(self, *, auth_token: str, date: str, content: str) -> dict[str, Any]:
        """直接用 token 写入/更新日记（不落库、不做 token 刷新）。"""
        url = "https://nideriji.cn/api/write/"
        payload = {"content": content, "date": date}
        async with httpx.AsyncClient(timeout=self._REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                url,
                data=payload,
                headers=self._build_headers(auth_token),
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

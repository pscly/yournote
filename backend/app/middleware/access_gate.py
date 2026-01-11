from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from ..config import settings
from ..utils.access_token import verify_token


class AccessGateMiddleware(BaseHTTPMiddleware):
    """访问密码门禁：对所有 API 请求强制做 Cookie 校验。"""

    def __init__(self, app):
        super().__init__(app)
        api_prefix = (settings.api_prefix or "/api").rstrip("/")
        self._api_prefix = api_prefix if api_prefix else "/api"
        raw = (settings.access_whitelist_paths or "").strip()
        self._whitelist = {p.strip() for p in raw.split(",") if p.strip()}

    async def dispatch(self, request: Request, call_next) -> Response:
        if not settings.access_enabled:
            return await call_next(request)

        # CORS 预检必须放行，否则浏览器会直接失败
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        path = request.url.path or ""

        # 只对 /api/** 生效，避免干扰 /health、/docs 等非 API 入口
        api_prefix = self._api_prefix
        if api_prefix and api_prefix != "/":
            if not path.startswith(f"{api_prefix}/"):
                return await call_next(request)

        # 白名单直接放行（登录 / 状态 / 登出等）
        if path in self._whitelist:
            return await call_next(request)

        token = request.cookies.get(settings.access_cookie_name)
        ok, _reason, _payload = verify_token(
            token,
            secret=settings.access_session_secret or "",
            expected_pwd_version=settings.access_password_version,
        )
        if ok:
            return await call_next(request)

        return JSONResponse({"detail": "ACCESS_REQUIRED"}, status_code=401)

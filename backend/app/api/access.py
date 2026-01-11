from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import Response

from ..config import settings
from ..utils.access_password import client_password_hash, verify_pbkdf2_sha256_hash
from ..utils.access_token import issue_token, verify_token


router = APIRouter(prefix="/access", tags=["access"])

_RATE_LOCK = threading.Lock()
_RATE_ATTEMPTS: dict[str, list[float]] = {}


def _get_client_ip(request: Request) -> str | None:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first

    xrip = request.headers.get("x-real-ip")
    if xrip:
        return xrip.strip() or None

    if request.client:
        return request.client.host
    return None


def _enforce_rate_limit(ip: str | None) -> None:
    if not ip:
        return

    window = int(getattr(settings, "access_rate_limit_window_seconds", 300) or 300)
    max_attempts = int(getattr(settings, "access_rate_limit_max_attempts", 20) or 20)
    if window <= 0 or max_attempts <= 0:
        return

    now = time.time()
    cutoff = now - window
    with _RATE_LOCK:
        items = [ts for ts in _RATE_ATTEMPTS.get(ip, []) if ts >= cutoff]
        _RATE_ATTEMPTS[ip] = items
        if len(items) >= max_attempts:
            raise HTTPException(status_code=429, detail="TOO_MANY_ATTEMPTS")


def _record_failed_attempt(ip: str | None) -> None:
    if not ip:
        return
    now = time.time()
    with _RATE_LOCK:
        _RATE_ATTEMPTS.setdefault(ip, []).append(now)


def _is_https(request: Request) -> bool:
    if (request.url.scheme or "").lower() == "https":
        return True

    xf_proto = request.headers.get("x-forwarded-proto")
    if xf_proto:
        first = xf_proto.split(",")[0].strip().lower()
        if first == "https":
            return True
    return False


def _resolve_cookie_secure(request: Request) -> bool:
    raw = (settings.access_cookie_secure or "auto").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return _is_https(request)


def _resolve_cookie_samesite() -> str:
    raw = (settings.access_cookie_samesite or "lax").strip().lower()
    if raw in {"lax", "strict", "none"}:
        return raw
    return "lax"


def _verify_password_hash(password_hash: str) -> bool:
    """校验前端传入的 password_hash（sha256 hex 字符串）。"""
    if not password_hash:
        return False

    configured_hash = (settings.access_password_hash or "").strip() or None
    if configured_hash:
        return verify_pbkdf2_sha256_hash(password_hash, configured_hash)

    plain = (settings.access_password_plaintext or settings.pwd or "").strip()
    if not plain:
        return False

    expected = client_password_hash(plain)
    # password_hash 是 sha256 hex，本身就是“可重放口令”，因此必须常量时间比较
    import hmac

    return hmac.compare_digest(expected, password_hash)


class LoginRequest(BaseModel):
    password_hash: str = Field(
        ...,
        min_length=1,
        description="前端对用户输入做 sha256 后的 hex 字符串（避免明文传输）",
    )


@router.post("/login")
async def login(body: LoginRequest, request: Request) -> Response:
    if not settings.access_enabled:
        return Response(status_code=204)

    ip = _get_client_ip(request)
    _enforce_rate_limit(ip)

    password_hash = (body.password_hash or "").strip()
    if not _verify_password_hash(password_hash):
        _record_failed_attempt(ip)
        raise HTTPException(status_code=401, detail="ACCESS_DENIED")

    token = issue_token(
        secret=settings.access_session_secret or "",
        pwd_version=settings.access_password_version,
        days=settings.access_session_days,
    )

    max_age = int(settings.access_session_days) * 24 * 60 * 60
    expires = datetime.now(timezone.utc) + timedelta(seconds=max_age)

    response = Response(status_code=204)
    response.set_cookie(
        key=settings.access_cookie_name,
        value=token,
        max_age=max_age,
        expires=expires,
        httponly=True,
        samesite=_resolve_cookie_samesite(),
        secure=_resolve_cookie_secure(request),
        path="/",
    )
    return response


@router.post("/logout")
async def logout() -> Response:
    response = Response(status_code=204)
    response.delete_cookie(
        key=settings.access_cookie_name,
        path="/",
    )
    return response


@router.get("/status")
async def status(request: Request) -> dict[str, bool]:
    if not settings.access_enabled:
        return {"ok": True}

    token = request.cookies.get(settings.access_cookie_name)
    ok, _reason, _payload = verify_token(
        token,
        secret=settings.access_session_secret or "",
        expected_pwd_version=settings.access_password_version,
    )
    if ok:
        return {"ok": True}
    raise HTTPException(status_code=401, detail="ACCESS_REQUIRED")

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _sign(payload_b64url: str, secret: str) -> str:
    sig = hmac.new(
        secret.encode("utf-8"),
        payload_b64url.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(sig)


def issue_token(*, secret: str, pwd_version: int, days: int) -> str:
    now = int(time.time())
    days = int(days or 0)
    if days <= 0:
        days = 90

    payload = {
        "v": 1,
        "iat": now,
        "exp": now + days * 24 * 60 * 60,
        "pwd_ver": int(pwd_version or 0),
    }
    payload_raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload_b64 = _b64url_encode(payload_raw)
    sig_b64 = _sign(payload_b64, secret)
    return f"{payload_b64}.{sig_b64}"


def verify_token(
    token: str | None,
    *,
    secret: str,
    expected_pwd_version: int,
    now: int | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    if not token:
        return False, "missing", None

    token = token.strip()
    if not token:
        return False, "missing", None

    parts = token.split(".")
    if len(parts) != 2:
        return False, "format", None

    payload_b64, sig_b64 = parts
    expected_sig = _sign(payload_b64, secret)
    if not hmac.compare_digest(expected_sig, sig_b64):
        return False, "bad_sig", None

    try:
        payload_raw = _b64url_decode(payload_b64)
        payload: Any = json.loads(payload_raw.decode("utf-8"))
        if not isinstance(payload, dict):
            return False, "bad_payload", None
    except Exception:
        return False, "bad_payload", None

    token_version = payload.get("v")
    if token_version != 1:
        return False, "bad_version", payload

    exp = payload.get("exp")
    try:
        exp_int = int(exp)
    except Exception:
        return False, "bad_exp", payload

    now_int = int(now if now is not None else time.time())
    if exp_int < now_int:
        return False, "expired", payload

    pwd_ver = payload.get("pwd_ver")
    try:
        pwd_ver_int = int(pwd_ver)
    except Exception:
        return False, "bad_pwd_ver", payload

    if pwd_ver_int != int(expected_pwd_version):
        return False, "pwd_ver_mismatch", payload

    return True, "ok", payload

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any


def _base64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def parse_jwt_payload(auth_token: str) -> dict[str, Any] | None:
    """解析 JWT payload（不校验签名），用于读取 exp 等字段。

    nideriji 的 token 通常长这样：`token <jwt>`。
    """
    if not auth_token or not isinstance(auth_token, str):
        return None

    jwt_part = auth_token.strip().split()[-1]
    parts = jwt_part.split(".")
    if len(parts) < 2:
        return None

    try:
        payload_raw = _base64url_decode(parts[1])
        payload: Any = json.loads(payload_raw.decode("utf-8"))
        if isinstance(payload, dict):
            return payload
        return None
    except Exception:
        return None


def get_token_expire_at(auth_token: str) -> datetime | None:
    payload = parse_jwt_payload(auth_token)
    if not payload:
        return None

    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        try:
            return datetime.fromtimestamp(float(exp), tz=timezone.utc)
        except Exception:
            return None
    return None


def get_token_status(auth_token: str) -> dict[str, Any]:
    """返回 token 状态（仅基于 JWT exp 的本地判断）。

    说明：
    - 这里只做“是否过期”的快速判断，不做服务端校验。
    - 若无法解析 exp，则视为“未校验/未知”，不会直接判定失效。
    """
    if not auth_token or not isinstance(auth_token, str):
        return {"is_valid": False, "expired": True, "expires_at": None, "reason": "token 为空"}

    expires_at = get_token_expire_at(auth_token)
    if not expires_at:
        return {"is_valid": True, "expired": False, "expires_at": None, "reason": "未解析到 exp（未校验）"}

    now = datetime.now(timezone.utc)
    expired = now >= expires_at
    if expired:
        return {"is_valid": False, "expired": True, "expires_at": expires_at, "reason": "token 已过期"}

    return {"is_valid": True, "expired": False, "expires_at": expires_at, "reason": None}

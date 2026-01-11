from __future__ import annotations

import base64
import hashlib
import hmac
import secrets


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _pbkdf2_sha256(secret: str, *, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256",
        secret.encode("utf-8"),
        salt,
        iterations,
    )


def generate_pbkdf2_sha256_hash(
    secret: str,
    *,
    iterations: int = 210_000,
    salt_bytes: int = 16,
) -> str:
    """生成 PBKDF2-SHA256 hash 字符串（适合存入 .env）。

    格式：pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>
    """
    if not secret:
        raise ValueError("secret 不能为空")
    if iterations <= 0:
        raise ValueError("iterations 必须 > 0")
    if salt_bytes <= 0:
        raise ValueError("salt_bytes 必须 > 0")

    salt = secrets.token_bytes(salt_bytes)
    dk = _pbkdf2_sha256(secret, salt=salt, iterations=iterations)
    salt_b64 = base64.b64encode(salt).decode("utf-8")
    hash_b64 = base64.b64encode(dk).decode("utf-8")
    return f"pbkdf2_sha256${iterations}${salt_b64}${hash_b64}"


def verify_pbkdf2_sha256_hash(secret: str, stored: str) -> bool:
    """校验 PBKDF2-SHA256 hash（常量时间比较）。"""
    if not secret or not stored:
        return False

    try:
        scheme, iterations_raw, salt_b64, hash_b64 = stored.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False

        iterations = int(iterations_raw)
        if iterations <= 0:
            return False

        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        actual = _pbkdf2_sha256(secret, salt=salt, iterations=iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def client_password_hash(plaintext_password: str) -> str:
    """前端/客户端口令 hash（用于避免明文传输）。

    约定：前端把用户输入做 sha256，然后把 hex 字符串传给后端（password_hash）。
    """
    return sha256_hex(plaintext_password)


def generate_access_password_hash(plaintext_password: str, *, iterations: int = 210_000) -> str:
    """生成 ACCESS_PASSWORD_HASH（推荐）：

    - 用户输入明文密码
    - 前端会先做 sha256，再传给后端
    - 后端存储时对 sha256(hex) 再做 PBKDF2，避免把“可重放的 sha256 值”明文落盘
    """
    secret = client_password_hash(plaintext_password)
    return generate_pbkdf2_sha256_hash(secret, iterations=iterations)

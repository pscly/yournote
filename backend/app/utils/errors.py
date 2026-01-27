from __future__ import annotations

import re
from typing import Any


_CONTROL_RE = re.compile(r"[\r\n\t]+")


def _sanitize_text(text: str, *, max_len: int) -> str:
    """把异常文本压缩成更适合日志/落盘的短字符串（避免换行、控制字符、超长）。"""
    if max_len <= 0:
        return ""
    cleaned = _CONTROL_RE.sub(" ", text).strip()
    if len(cleaned) > max_len:
        return f"{cleaned[:max_len]}…"
    return cleaned


def exception_summary(exc: BaseException, *, max_len: int = 200) -> str:
    """生成对外更安全的异常摘要：默认仅保留异常类型 + 截断后的消息。"""
    name = type(exc).__name__
    msg = _sanitize_text(str(exc), max_len=max_len)
    return f"{name}: {msg}" if msg else name


def safe_str(value: Any, *, max_len: int = 200) -> str:
    """把任意值转换为适合对外/日志展示的短文本。"""
    return _sanitize_text(str(value), max_len=max_len)


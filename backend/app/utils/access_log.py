from __future__ import annotations

import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

from .. import config as config_module
from ..config import settings


_WRITE_LOCK = threading.Lock()


def _now_iso() -> str:
    # 使用本地时区，方便直接对照“什么时候发生的”
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _sanitize_text(value: str, *, max_len: int = 800) -> str:
    text = value.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
    if len(text) > max_len:
        return f"{text[:max_len]}…"
    return text


def _logfmt_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = _sanitize_text(str(value))
    # 只要包含空白或特殊字符，就用引号包起来（更可读，解析也更稳）
    if not text or any(ch.isspace() for ch in text) or any(ch in text for ch in ['"', "=", "\\"]):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f"\"{escaped}\""
    return text


def _to_logfmt(fields: list[tuple[str, Any]]) -> str:
    parts: list[str] = []
    for key, value in fields:
        if value is None:
            continue
        rendered = _logfmt_value(value)
        if rendered == "":
            continue
        parts.append(f"{key}={rendered}")
    return " ".join(parts)


def _resolve_log_dir() -> Path:
    log_dir = Path(settings.access_log_dir)
    if log_dir.is_absolute():
        return log_dir
    # 统一落在仓库根目录，方便用户直接打开
    return (config_module._REPO_ROOT / log_dir).resolve()


def _daily_log_path(now: datetime | None = None) -> Path:
    dt = now or datetime.now().astimezone()
    filename = f"{dt.strftime('%Y-%m-%d')}.logs"
    return _resolve_log_dir() / filename


def _append_line_sync(line: str, *, now: datetime | None = None) -> Path:
    path = _daily_log_path(now)
    path.parent.mkdir(parents=True, exist_ok=True)

    normalized = line.rstrip("\n") + "\n"
    # 多线程下避免多条日志交叉写入；多进程场景不保证完全互斥，但对本项目已足够
    with _WRITE_LOCK:
        with path.open("a", encoding="utf-8", newline="\n") as f:
            f.write(normalized)
    return path


async def append_line(line: str, *, now: datetime | None = None) -> Path:
    return await run_in_threadpool(_append_line_sync, line, now=now)


def _get_client_ip(request: Request) -> str | None:
    # 兼容反向代理（如果有）
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


def _should_ignore(request: Request) -> bool:
    raw = (settings.access_log_ignore_paths or "").strip()
    if not raw:
        return False
    ignore = {p.strip() for p in raw.split(",") if p.strip()}
    return request.url.path in ignore


async def log_http_request(
    request: Request,
    *,
    status_code: int,
    duration_ms: int,
    error: str | None = None,
) -> None:
    if not settings.access_log_enabled:
        return
    if _should_ignore(request):
        return

    query = request.url.query if settings.access_log_include_query else None
    line = _to_logfmt(
        [
            ("ts", _now_iso()),
            ("kind", "http"),
            ("method", request.method),
            ("path", request.url.path),
            ("query", query or None),
            ("status", status_code),
            ("dur_ms", duration_ms),
            ("ip", _get_client_ip(request)),
            ("ua", request.headers.get("user-agent")),
            ("referer", request.headers.get("referer")),
            ("error", error),
        ]
    )
    await append_line(line)


async def log_pageview(
    request: Request,
    *,
    path: str,
    client_id: str | None = None,
    title: str | None = None,
    referrer: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    if not settings.access_log_enabled:
        return

    line = _to_logfmt(
        [
            ("ts", _now_iso()),
            ("kind", "page"),
            ("path", path),
            ("client_id", client_id),
            ("title", title),
            ("referrer", referrer),
            ("ip", _get_client_ip(request)),
            ("ua", request.headers.get("user-agent")),
            ("extra", extra if extra else None),
        ]
    )
    await append_line(line)


class AccessLogTimer:
    """简单计时器：用于计算请求耗时（ms）。"""

    def __init__(self) -> None:
        self._start = time.perf_counter()

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._start) * 1000)


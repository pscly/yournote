"""上游 HTTP 请求辅助（重试/退避）

目标：
- 对“网络抖动/瞬断”等非业务性问题提供有限重试，降低同步/发布失败率。
- 不对业务性 HTTP 状态码做盲目重试（例如 401/403/422），这些应由调用方处理。

实现原则：
- 只重试 httpx 的网络类异常（RequestError/TimeoutException 等）。
- 使用指数退避 + 少量抖动（jitter），避免并发账号在同一时刻集体重试。
- 在最终抛出的异常对象上附加元信息（例如 younote_attempts），便于上层生成可读错误提示。
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

import httpx


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _compute_backoff_seconds(
    *,
    attempt: int,
    base: float,
    max_backoff: float,
    jitter_ratio: float,
) -> float:
    if base <= 0:
        return 0.0

    exp = max(0, int(attempt) - 1)
    delay = base * (2**exp)
    if max_backoff > 0:
        delay = min(delay, max_backoff)

    if jitter_ratio > 0:
        jitter = delay * jitter_ratio
        delay += random.random() * jitter

    return max(0.0, float(delay))


async def request_with_retry(
    *,
    client: httpx.AsyncClient,
    method: str,
    url: str,
    max_attempts: int,
    backoff_seconds: float,
    max_backoff_seconds: float = 5.0,
    jitter_ratio: float = 0.1,
    **kwargs: Any,
) -> httpx.Response:
    """对网络类异常做有限重试，成功则返回 Response，失败则抛出最后一次异常。"""
    attempts = max(1, _to_int(max_attempts, 1))
    base = max(0.0, _to_float(backoff_seconds, 0.0))
    max_backoff = max(0.0, _to_float(max_backoff_seconds, 0.0))
    jitter = max(0.0, _to_float(jitter_ratio, 0.0))

    last_exc: httpx.RequestError | None = None
    method_up = (method or "GET").upper()

    for attempt in range(1, attempts + 1):
        try:
            return await client.request(method_up, url, **kwargs)
        except httpx.RequestError as e:
            last_exc = e

            # 最后一次失败：在异常对象上打标，便于上层展示“已重试 N 次”
            if attempt >= attempts:
                try:
                    setattr(e, "yournote_attempts", attempt)
                    setattr(e, "yournote_max_attempts", attempts)
                    setattr(e, "yournote_url", str(url))
                    setattr(e, "yournote_method", method_up)
                except Exception:
                    pass
                raise

            sleep_s = _compute_backoff_seconds(
                attempt=attempt,
                base=base,
                max_backoff=max_backoff,
                jitter_ratio=jitter,
            )
            if sleep_s > 0:
                await asyncio.sleep(sleep_s)

    # 理论上不会走到这里（attempts>=1），但为类型检查保留兜底
    if last_exc is not None:
        raise last_exc
    raise httpx.RequestError("未知网络异常", request=None)


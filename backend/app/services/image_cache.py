from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import CachedImage
from ..utils.errors import safe_str

logger = logging.getLogger(__name__)

_IMAGE_PLACEHOLDER_RE = re.compile(r"\\[图(\\d+)\\]")


def _to_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class ImageCacheService:
    """图片缓存服务：从上游拉取图片并写入本地数据库。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def extract_image_ids(content: str | None) -> list[int]:
        """从正文中解析图片占位符 `[图13]` 的 image_id 列表（按出现顺序去重）。"""
        text = content or ""
        ids: list[int] = []
        seen: set[int] = set()
        for m in _IMAGE_PLACEHOLDER_RE.finditer(text):
            raw = m.group(1)
            try:
                image_id = int(raw)
            except Exception:
                continue
            if image_id <= 0:
                continue
            if image_id in seen:
                continue
            seen.add(image_id)
            ids.append(image_id)
        return ids

    def _build_headers(self, auth_token: str) -> dict[str, str]:
        # 与 CollectorService 保持一致：关键是 auth header
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36"
            ),
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "auth": auth_token,
            "origin": "https://nideriji.cn",
            "referer": "https://nideriji.cn/w/",
        }

    def _retry_after(self, status: str | None) -> timedelta:
        s = (status or "").strip().lower()
        if s in ("forbidden", "not_found"):
            return timedelta(hours=24)
        if s in ("error", "unknown"):
            return timedelta(minutes=10)
        return timedelta(seconds=0)

    def _should_skip_fetch(self, existing: CachedImage) -> bool:
        status = (existing.fetch_status or "").strip().lower()
        if status == "ok" and existing.data:
            return True

        retry_after = self._retry_after(status)
        if retry_after <= timedelta(seconds=0):
            return False

        fetched_at = _to_utc(existing.fetched_at)
        if fetched_at is None:
            return False

        return datetime.now(timezone.utc) - fetched_at < retry_after

    async def get_cached(self, *, nideriji_userid: int, image_id: int) -> CachedImage | None:
        return await self.db.scalar(
            select(CachedImage).where(
                CachedImage.nideriji_userid == nideriji_userid,
                CachedImage.image_id == image_id,
            )
        )

    async def build_attachments_for_content(
        self,
        *,
        diary_id: int,
        nideriji_userid: int,
        content: str | None,
    ) -> dict[str, object]:
        """为某条记录构建附件信息（不触发拉取，仅基于占位符与缓存状态）。"""
        image_ids = self.extract_image_ids(content)
        if not image_ids:
            return {"images": []}

        cached_result = await self.db.execute(
            select(CachedImage).where(
                CachedImage.nideriji_userid == nideriji_userid,
                CachedImage.image_id.in_(image_ids),
            )
        )
        cached_list = cached_result.scalars().all()
        cached_by_id = {c.image_id: c for c in cached_list if isinstance(getattr(c, "image_id", None), int)}

        api_prefix = (settings.api_prefix or "/api").rstrip("/") or "/api"
        images: list[dict[str, object]] = []
        for image_id in image_ids:
            c = cached_by_id.get(image_id)
            status = getattr(c, "fetch_status", None) if c else None
            cached_ok = bool(c and (c.fetch_status or "") == "ok" and c.data)
            images.append(
                {
                    "image_id": image_id,
                    "url": f"{api_prefix}/diaries/{diary_id}/images/{image_id}",
                    "cached": cached_ok,
                    "status": status,
                }
            )

        return {"images": images}

    async def fetch_from_upstream(
        self,
        *,
        auth_token: str,
        nideriji_userid: int,
        image_id: int,
        client: httpx.AsyncClient,
    ) -> tuple[bytes, str, str]:
        """从上游拉取图片，返回 (bytes, content_type, sha256)。"""
        base = (settings.nideriji_image_base_url or "https://f.nideriji.cn/api/image").rstrip("/")
        url = f"{base}/{nideriji_userid}/{image_id}/"

        max_size = int(settings.image_cache_max_size_bytes or 0) or 10 * 1024 * 1024
        headers = self._build_headers(auth_token)

        # 图片通常很小，但仍做一次限流保护，避免异常大文件拖垮内存。
        async with client.stream("GET", url, headers=headers, follow_redirects=True) as resp:
            resp.raise_for_status()

            raw_ct = (resp.headers.get("content-type") or "").strip()
            content_type = raw_ct.split(";", 1)[0].strip() if raw_ct else "application/octet-stream"

            # 若 Content-Length 明确且超过阈值，直接拒绝
            raw_len = (resp.headers.get("content-length") or "").strip()
            if raw_len.isdigit() and int(raw_len) > max_size:
                raise ValueError(f"图片过大：content-length={raw_len} > {max_size}")

            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.aiter_bytes():
                if not chunk:
                    continue
                size += len(chunk)
                if size > max_size:
                    raise ValueError(f"图片过大：size>{max_size}")
                chunks.append(chunk)

        data = b"".join(chunks)
        sha256 = hashlib.sha256(data).hexdigest()
        return data, content_type, sha256

    async def ensure_cached(
        self,
        *,
        auth_token: str,
        nideriji_userid: int,
        image_id: int,
        client: httpx.AsyncClient | None = None,
    ) -> CachedImage | None:
        """确保图片已缓存（带退避），返回最新缓存记录（可能是失败状态）。"""
        existing = await self.get_cached(nideriji_userid=nideriji_userid, image_id=image_id)
        if existing and self._should_skip_fetch(existing):
            return existing

        # 若用户关闭缓存，则只做一次“代理拉取”，不写入数据库。
        if not bool(settings.image_cache_enabled):
            timeout = float(settings.image_cache_timeout_seconds or 20)
            async with httpx.AsyncClient(timeout=timeout) as temp_client:
                data, content_type, sha256 = await self.fetch_from_upstream(
                    auth_token=auth_token,
                    nideriji_userid=nideriji_userid,
                    image_id=image_id,
                    client=temp_client,
                )
            return CachedImage(
                nideriji_userid=nideriji_userid,
                image_id=image_id,
                content_type=content_type,
                data=data,
                size_bytes=len(data),
                sha256=sha256,
                fetch_status="ok",
                error_message=None,
                fetched_at=datetime.now(timezone.utc),
            )

        record = existing
        if record is None:
            record = CachedImage(nideriji_userid=nideriji_userid, image_id=image_id)
            self.db.add(record)
            await self.db.flush()

        timeout = float(settings.image_cache_timeout_seconds or 20)

        created_client = False
        if client is None:
            client = httpx.AsyncClient(timeout=timeout)
            created_client = True

        try:
            data, content_type, sha256 = await self.fetch_from_upstream(
                auth_token=auth_token,
                nideriji_userid=nideriji_userid,
                image_id=image_id,
                client=client,
            )
            record.content_type = content_type
            record.data = data
            record.size_bytes = len(data)
            record.sha256 = sha256
            record.fetch_status = "ok"
            record.error_message = None
            record.fetched_at = datetime.now(timezone.utc)
            await self.db.flush()
            return record
        except httpx.HTTPStatusError as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 403:
                record.fetch_status = "forbidden"
            elif status_code == 404:
                record.fetch_status = "not_found"
            else:
                record.fetch_status = "error"
            record.data = None
            record.size_bytes = None
            record.sha256 = None
            record.fetched_at = datetime.now(timezone.utc)
            record.error_message = safe_str(e, max_len=300)
            await self.db.flush()
            return record
        except httpx.TimeoutException as e:
            record.fetch_status = "error"
            record.data = None
            record.size_bytes = None
            record.sha256 = None
            record.fetched_at = datetime.now(timezone.utc)
            record.error_message = safe_str(e, max_len=300)
            await self.db.flush()
            return record
        except httpx.RequestError as e:
            record.fetch_status = "error"
            record.data = None
            record.size_bytes = None
            record.sha256 = None
            record.fetched_at = datetime.now(timezone.utc)
            record.error_message = safe_str(e, max_len=300)
            await self.db.flush()
            return record
        except Exception as e:
            record.fetch_status = "error"
            record.data = None
            record.size_bytes = None
            record.sha256 = None
            record.fetched_at = datetime.now(timezone.utc)
            record.error_message = safe_str(e, max_len=300)
            await self.db.flush()
            return record
        finally:
            if created_client:
                try:
                    await client.aclose()
                except Exception:
                    pass

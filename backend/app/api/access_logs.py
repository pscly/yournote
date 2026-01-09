"""访问日志 API：用于前端上报“页面访问”事件（后端负责落盘到本地 logs/）。"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import config as config_module
from ..config import settings
from ..utils.access_log import log_pageview


router = APIRouter(prefix="/access-logs", tags=["access-logs"])


class PageViewEvent(BaseModel):
    path: str = Field(..., description="前端路由路径，如 /diaries?user=1")
    client_id: str | None = Field(default=None, description="浏览器端生成的稳定 ID")
    title: str | None = Field(default=None, description="页面标题")
    referrer: str | None = Field(default=None, description="来源页面（document.referrer）")
    extra: dict[str, Any] | None = Field(default=None, description="额外信息（可选）")


def _resolve_log_dir() -> Path:
    log_dir = Path(settings.access_log_dir)
    if log_dir.is_absolute():
        return log_dir
    return (config_module._REPO_ROOT / log_dir).resolve()


@router.post("/pageview")
async def pageview(event: PageViewEvent, request: Request) -> dict[str, Any]:
    """前端上报页面访问事件（写入当日日志文件）。"""
    if not settings.access_log_enabled:
        return {"ok": True, "enabled": False}

    path = (event.path or "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="path 不能为空")

    await log_pageview(
        request,
        path=path,
        client_id=(event.client_id or None),
        title=(event.title or None),
        referrer=(event.referrer or None),
        extra=event.extra,
    )
    return {"ok": True, "enabled": True}


@router.get("/file")
async def get_log_file_path(date: str | None = None) -> dict[str, Any]:
    """返回指定日期的日志文件路径（方便在前端/接口测试里确认落盘位置）。"""
    if not settings.access_log_enabled:
        return {"enabled": False, "path": None}

    if date:
        try:
            dt = datetime.strptime(date, "%Y-%m-%d")
        except ValueError as e:
            raise HTTPException(status_code=400, detail="date 格式必须为 YYYY-MM-DD") from e
        filename = f"{dt.strftime('%Y-%m-%d')}.logs"
    else:
        filename = f"{datetime.now().astimezone().strftime('%Y-%m-%d')}.logs"

    path = _resolve_log_dir() / filename
    return {"enabled": True, "path": str(path)}


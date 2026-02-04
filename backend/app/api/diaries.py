"""Diary query API"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Account, Diary, User
from ..schemas import DiaryAttachments, DiaryDetailResponse, DiaryRefreshResponse, DiaryResponse
from ..services import CollectorService
from ..services.image_cache import ImageCacheService
from ..utils.errors import safe_str

router = APIRouter(prefix="/diaries", tags=["diaries"])
logger = logging.getLogger(__name__)


@router.get("", response_model=list[DiaryResponse])
async def list_diaries(
    account_id: int | None = None,
    user_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """获取日记列表（支持筛选）"""
    query = select(Diary).order_by(Diary.created_date.desc()).limit(limit).offset(offset)

    if account_id:
        query = query.where(Diary.account_id == account_id)
    if user_id:
        query = query.where(Diary.user_id == user_id)

    result = await db.execute(query)
    diaries = result.scalars().all()
    return diaries


@router.get("/{diary_id}", response_model=DiaryDetailResponse)
async def get_diary(
    diary_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取单条日记详情"""
    result = await db.execute(select(Diary).where(Diary.id == diary_id))
    diary = result.scalar_one_or_none()
    if not diary:
        raise HTTPException(status_code=404, detail="Diary not found")

    # 附件（图片）信息：不阻塞拉取，仅用于前端把 `[图13]` 映射成稳定 URL
    user = await db.scalar(select(User).where(User.id == diary.user_id))
    nideriji_userid = getattr(user, "nideriji_userid", None)
    attachments = None
    if isinstance(nideriji_userid, int) and nideriji_userid > 0:
        service = ImageCacheService(db)
        attachments = DiaryAttachments(
            **await service.build_attachments_for_content(
                diary_id=diary.id,
                nideriji_userid=nideriji_userid,
                content=diary.content,
            )
        )

    base = DiaryResponse.model_validate(diary)
    return DiaryDetailResponse(**base.model_dump(), attachments=attachments)


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not isinstance(if_none_match, str) or not if_none_match.strip():
        return False
    raw = if_none_match.strip()
    if raw == "*":
        return True
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if etag in parts:
        return True
    # 兼容客户端不带引号的情况（极少见）
    stripped = etag.strip("\"")
    return stripped in [p.strip("\"") for p in parts]


@router.get("/{diary_id}/images/{image_id}")
async def get_diary_image(
    diary_id: int,
    image_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取某条记录引用的图片（优先从本地 DB 缓存读取，不存在则自动拉取并缓存）。"""
    diary = await db.scalar(select(Diary).where(Diary.id == diary_id))
    if not diary:
        raise HTTPException(status_code=404, detail="Diary not found")

    account = await db.scalar(select(Account).where(Account.id == diary.account_id))
    if not account or not isinstance(getattr(account, "auth_token", None), str) or not account.auth_token.strip():
        raise HTTPException(status_code=404, detail="Account token not found")

    user = await db.scalar(select(User).where(User.id == diary.user_id))
    nideriji_userid = getattr(user, "nideriji_userid", None)
    if not isinstance(nideriji_userid, int) or nideriji_userid <= 0:
        raise HTTPException(status_code=404, detail="User not found")

    service = ImageCacheService(db)
    record = await service.ensure_cached(
        auth_token=account.auth_token,
        nideriji_userid=nideriji_userid,
        image_id=image_id,
    )

    status = (getattr(record, "fetch_status", None) or "").strip().lower() if record else ""
    if status != "ok" or not record or not record.data:
        # 为了 `<img>` 体验更一致：无权限/不存在统一返回 404，让前端走 onError 占位。
        if status in {"forbidden", "not_found"}:
            raise HTTPException(status_code=404, detail="IMAGE_NOT_AVAILABLE")
        raise HTTPException(status_code=502, detail="IMAGE_FETCH_FAILED")

    sha256 = (record.sha256 or "").strip()
    etag = f"\"{sha256}\"" if sha256 else ""
    headers = {
        "Cache-Control": "private, max-age=31536000",
    }
    if etag:
        headers["ETag"] = etag

    if etag and _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)

    media_type = (record.content_type or "").strip() or "application/octet-stream"
    return Response(content=record.data, media_type=media_type, headers=headers)


@router.get("/by-account/{account_id}", response_model=list[DiaryResponse])
async def get_diaries_by_account(
    account_id: int,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """按账号查询日记"""
    result = await db.execute(
        select(Diary)
        .where(Diary.account_id == account_id)
        .order_by(Diary.created_date.desc())
        .limit(limit)
    )
    diaries = result.scalars().all()
    return diaries


@router.post("/{diary_id}/refresh", response_model=DiaryRefreshResponse)
async def refresh_diary(
    diary_id: int,
    db: AsyncSession = Depends(get_db),
):
    """强制刷新某条日记详情（先走 sync，不合适再走 all_by_ids）。"""
    collector = CollectorService(db)
    try:
        diary, refresh_info = await collector.refresh_diary(diary_id)
        return {"diary": diary, "refresh_info": refresh_info}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_str(e)) from e
    except Exception as e:
        logger.exception("[DIARY] Refresh failed diary_id=%s", diary_id)
        raise HTTPException(status_code=500, detail="Refresh failed") from e

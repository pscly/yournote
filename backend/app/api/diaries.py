"""Diary query API"""

from __future__ import annotations

import logging
import re
import time
from datetime import date
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import engine, get_db
from ..models import Account, Diary, PairedRelationship, User
from ..schemas import (
    DiaryAttachments,
    DiaryBookmarkBatchResponse,
    DiaryBookmarkBatchUpsertRequest,
    DiaryBookmarkItemResponse,
    DiaryBookmarkUpsertRequest,
    DiaryDetailResponse,
    DiaryListItemResponse,
    DiaryQueryNormalized,
    DiaryQueryResponse,
    DiaryRefreshResponse,
    DiaryResponse,
)
from ..services import CollectorService
from ..services.image_cache import ImageCacheService
from ..utils.errors import safe_str

router = APIRouter(prefix="/diaries", tags=["diaries"])
logger = logging.getLogger(__name__)

_WS_RE = re.compile(r"\s+", flags=re.UNICODE)
_LIKE_ESCAPE = "\\"


def _escape_like_term(value: str) -> str:
    """转义 LIKE 模式中的特殊字符，避免用户输入意外触发通配或转义。"""
    if not value:
        return ""
    return (
        value.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", _LIKE_ESCAPE + "%")
        .replace("_", _LIKE_ESCAPE + "_")
    )


def _split_search_terms(raw: str, *, max_terms: int = 5) -> list[str]:
    parts = [p.strip() for p in re.split(r"\s+", raw or "") if p and p.strip()]
    # 去重但保持顺序，避免同词重复导致 SQL 条件膨胀
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
        if len(out) >= max_terms:
            break
    return out


def _parse_smart_search_query(
    raw: str,
    *,
    max_positive_terms: int = 5,
    max_excludes: int = 5,
) -> tuple[list[str], list[str], list[str]]:
    """解析智能搜索语法（引号短语 + 排除词）。

    支持：
    - 普通关键词：foo bar
    - 短语：\"foo bar\"
    - 排除：-foo 或 -\"foo bar\"
    """

    s = str(raw or "").strip()
    if not s:
        return [], [], []

    terms: list[str] = []
    phrases: list[str] = []
    excludes: list[str] = []

    pos_seen: set[str] = set()
    exc_seen: set[str] = set()
    pos_count = 0

    i = 0
    n = len(s)

    while i < n:
        # skip spaces
        while i < n and s[i].isspace():
            i += 1
        if i >= n:
            break

        neg = False
        if s[i] == "-":
            neg = True
            i += 1
            while i < n and s[i].isspace():
                i += 1
            if i >= n:
                break

        quoted = False
        token = ""
        if i < n and s[i] == '"':
            quoted = True
            i += 1
            start = i
            while i < n and s[i] != '"':
                i += 1
            token = s[start:i].strip()
            if i < n and s[i] == '"':
                i += 1
        else:
            start = i
            while i < n and not s[i].isspace():
                i += 1
            token = s[start:i].strip()

        if not token:
            continue

        key = token.lower()
        if neg:
            if len(excludes) >= max_excludes:
                # 超限则忽略后续排除条件（避免 SQL 条件膨胀）
                continue
            if key in exc_seen:
                continue
            exc_seen.add(key)
            excludes.append(token)
            continue

        if pos_count >= max_positive_terms:
            continue
        if key in pos_seen:
            continue
        pos_seen.add(key)
        pos_count += 1
        if quoted:
            phrases.append(token)
        else:
            terms.append(token)

    return terms, phrases, excludes


def _parse_date_yyyy_mm_dd(value: str | None, field_name: str) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as e:
        raise HTTPException(
            status_code=422, detail=f"{field_name} must be YYYY-MM-DD"
        ) from e


def _count_no_whitespace(text: str | None) -> int:
    if not text:
        return 0
    return len(_WS_RE.sub("", str(text)))


def _build_preview(text: str | None, preview_len: int) -> str:
    if preview_len <= 0:
        return ""
    raw = "" if text is None else str(text)
    if len(raw) <= preview_len:
        return raw

    return raw[:preview_len] + "…"


def _build_match_snippet(
    text: str | None, preview_len: int, match_terms: list[str]
) -> str:
    """构造“命中附近片段”预览，提升搜索结果可读性。"""
    if preview_len <= 0:
        return ""
    raw = "" if text is None else str(text)
    if len(raw) <= preview_len:
        return raw
    if not match_terms:
        return raw[:preview_len] + "…"

    raw_lower = raw.lower()
    best_idx: int | None = None
    for t in match_terms:
        term = str(t or "").strip().lower()
        if not term:
            continue
        idx = raw_lower.find(term)
        if idx < 0:
            continue
        if best_idx is None or idx < best_idx:
            best_idx = idx

    if best_idx is None:
        return raw[:preview_len] + "…"

    # 让命中点前留一点上下文（约 25%）
    start = max(0, best_idx - int(preview_len * 0.25))
    snippet = raw[start : start + preview_len]
    prefix = "…" if start > 0 else ""
    suffix = "…" if (start + preview_len) < len(raw) else ""
    return f"{prefix}{snippet}{suffix}"


@router.get("", response_model=list[DiaryResponse])
async def list_diaries(
    account_id: int | None = None,
    user_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """获取日记列表（支持筛选）"""
    query = (
        select(Diary).order_by(Diary.created_date.desc()).limit(limit).offset(offset)
    )

    if account_id:
        query = query.where(Diary.account_id == account_id)
    if user_id:
        query = query.where(Diary.user_id == user_id)

    result = await db.execute(query)
    diaries = result.scalars().all()
    return diaries


@router.get("/query", response_model=DiaryQueryResponse)
async def query_diaries(
    q: str | None = Query(None, description="关键字（标题/正文，空格分词，默认 AND）"),
    q_mode: str = Query(
        "and", description="关键字模式：and=全部命中（默认），or=命中任一"
    ),
    q_syntax: str = Query(
        "smart", description="查询语法：smart=支持引号短语/排除词，plain=纯文本"
    ),
    scope: str = Query(
        "matched", description="范围：matched=仅配对用户记录，all=全部记录"
    ),
    account_id: int | None = Query(None, ge=1, description="按账号过滤"),
    user_id: int | None = Query(None, ge=1, description="按作者 user_id 过滤"),
    date_from: str | None = Query(None, description="起始日期（YYYY-MM-DD，含）"),
    date_to: str | None = Query(None, description="结束日期（YYYY-MM-DD，含）"),
    include_inactive: bool = Query(True, description="是否包含停用账号"),
    include_stats: bool = Query(True, description="是否返回字数等统计字段"),
    include_preview: bool = Query(
        True, description="是否返回 content_preview（列表预览）"
    ),
    bookmarked: bool | None = Query(
        None,
        description="是否收藏过滤：true=仅收藏，false=仅未收藏，不传=不过滤",
    ),
    has_msg: bool | None = Query(
        None,
        description=(
            "是否有留言过滤：true=仅有留言（msg_count>0），"
            "false=仅无留言（msg_count<=0），不传=不过滤"
        ),
    ),
    limit: int = Query(50, ge=1, le=200, description="分页大小"),
    offset: int = Query(0, ge=0, description="分页 offset"),
    order_by: str = Query(
        "ts", description="排序字段：ts/created_date/created_at/bookmarked_at/msg_count"
    ),
    order: str = Query("desc", description="排序方向：desc/asc"),
    preview_len: int = Query(120, ge=0, le=1000, description="内容预览长度（字符数）"),
    db: AsyncSession = Depends(get_db),
):
    """记录查询（支持搜索/筛选/分页）。"""
    started = time.perf_counter()

    scope_norm = (scope or "").strip().lower() or "matched"
    if scope_norm not in {"matched", "all"}:
        raise HTTPException(status_code=422, detail="scope must be matched or all")

    q_mode_norm = (q_mode or "").strip().lower() or "and"
    if q_mode_norm not in {"and", "or"}:
        raise HTTPException(status_code=422, detail="q_mode must be and or or")

    q_syntax_norm = (q_syntax or "").strip().lower() or "smart"
    if q_syntax_norm not in {"smart", "plain"}:
        raise HTTPException(status_code=422, detail="q_syntax must be smart or plain")

    order_by_norm = (order_by or "").strip().lower() or "ts"
    if order_by_norm not in {
        "ts",
        "created_date",
        "created_at",
        "bookmarked_at",
        "msg_count",
    }:
        raise HTTPException(
            status_code=422,
            detail="order_by must be ts, created_date, created_at, bookmarked_at or msg_count",
        )

    order_norm = (order or "").strip().lower() or "desc"
    if order_norm not in {"desc", "asc"}:
        raise HTTPException(status_code=422, detail="order must be desc or asc")

    df = _parse_date_yyyy_mm_dd(date_from, "date_from")
    dt = _parse_date_yyyy_mm_dd(date_to, "date_to")
    if df and dt and dt < df:
        raise HTTPException(
            status_code=422, detail="date_to must be greater than or equal to date_from"
        )

    where_clauses = []
    if account_id is not None:
        where_clauses.append(Diary.account_id == account_id)
    if user_id is not None:
        where_clauses.append(Diary.user_id == user_id)
    if df is not None:
        where_clauses.append(Diary.created_date >= df)
    if dt is not None:
        where_clauses.append(Diary.created_date <= dt)

    if bookmarked is True:
        where_clauses.append(Diary.bookmarked_at.is_not(None))
    elif bookmarked is False:
        where_clauses.append(Diary.bookmarked_at.is_(None))

    if has_msg is True:
        where_clauses.append(func.coalesce(Diary.msg_count, 0) > 0)
    elif has_msg is False:
        where_clauses.append(func.coalesce(Diary.msg_count, 0) <= 0)

    q_text = (q or "").strip()
    if q_syntax_norm == "plain":
        terms = _split_search_terms(q_text, max_terms=5)
        phrases: list[str] = []
        excludes: list[str] = []
    else:
        terms, phrases, excludes = _parse_smart_search_query(
            q_text, max_positive_terms=5, max_excludes=5
        )

    positive = [t for t in (terms + phrases) if isinstance(t, str) and t.strip()]

    if positive or excludes:
        # PostgreSQL：优先用 ILIKE，避免 lower(col) 这种“包一层函数”导致索引（如未来 trigram）无法命中
        dialect_obj = getattr(engine, "dialect", None)
        dialect = str(getattr(dialect_obj, "name", "") or "").lower()
        use_ilike = dialect.startswith("postgresql")

        title_expr = func.coalesce(Diary.title, "")
        content_expr = func.coalesce(Diary.content, "")
        if not use_ilike:
            title_expr = func.lower(title_expr)
            content_expr = func.lower(content_expr)

        def _match_clause(token: str):
            t = _escape_like_term(token.lower())
            pattern = f"%{t}%"
            if use_ilike:
                return or_(
                    title_expr.ilike(pattern, escape=_LIKE_ESCAPE),
                    content_expr.ilike(pattern, escape=_LIKE_ESCAPE),
                )
            return or_(
                title_expr.like(pattern, escape=_LIKE_ESCAPE),
                content_expr.like(pattern, escape=_LIKE_ESCAPE),
            )

        if positive:
            if q_mode_norm == "and":
                for token in positive:
                    where_clauses.append(_match_clause(token))
            else:
                where_clauses.append(or_(*[_match_clause(token) for token in positive]))

        for token in excludes:
            if not isinstance(token, str) or not token.strip():
                continue
            where_clauses.append(~_match_clause(token))

    matched_exists_clause = (
        select(1)
        .select_from(PairedRelationship)
        .where(
            PairedRelationship.account_id == Diary.account_id,
            PairedRelationship.paired_user_id == Diary.user_id,
            PairedRelationship.is_active.is_(True),
        )
        .exists()
    )

    if scope_norm == "matched":
        where_clauses.append(matched_exists_clause)

    def _apply_joins(query):
        if not include_inactive:
            query = query.join(Account, Diary.account_id == Account.id).where(
                Account.is_active.is_(True)
            )
        return query

    count_query = select(func.count()).select_from(Diary)
    count_query = _apply_joins(count_query).where(*where_clauses)
    total = int((await db.scalar(count_query)) or 0)

    col_map = {
        "ts": Diary.ts,
        "created_date": Diary.created_date,
        "created_at": Diary.created_at,
        "bookmarked_at": Diary.bookmarked_at,
        "msg_count": func.coalesce(Diary.msg_count, 0),
    }
    primary_col = col_map[order_by_norm]
    if order_norm == "asc":
        primary_order = primary_col.asc()
        id_order = Diary.id.asc()
        date_order = Diary.created_date.asc()
    else:
        primary_order = primary_col.desc()
        id_order = Diary.id.desc()
        date_order = Diary.created_date.desc()

    order_clauses = []
    if order_by_norm == "bookmarked_at":
        order_clauses.append(Diary.bookmarked_at.is_(None).asc())
    order_clauses.append(primary_order)
    if order_by_norm != "created_date":
        order_clauses.append(date_order)
    order_clauses.append(id_order)

    items_query = select(Diary).select_from(Diary)
    items_query = (
        _apply_joins(items_query)
        .where(*where_clauses)
        .order_by(*order_clauses)
        .limit(limit)
        .offset(offset)
    )

    diaries = await db.scalars(items_query)
    diaries = list(diaries.all())

    match_terms_for_preview = positive
    items: list[DiaryListItemResponse] = []
    for d in diaries:
        if d is None:
            continue
        dd = cast(Any, d)
        items.append(
            DiaryListItemResponse(
                id=int(dd.id),
                nideriji_diary_id=int(dd.nideriji_diary_id),
                user_id=int(dd.user_id),
                account_id=int(dd.account_id),
                created_date=dd.created_date,
                ts=dd.ts,
                bookmarked_at=getattr(dd, "bookmarked_at", None),
                created_at=dd.created_at,
                updated_at=dd.updated_at,
                title=dd.title,
                content_preview=(
                    _build_match_snippet(
                        dd.content, preview_len, match_terms_for_preview
                    )
                    if include_preview
                    else None
                ),
                word_count_no_ws=_count_no_whitespace(dd.content)
                if include_stats
                else 0,
                msg_count=int(getattr(dd, "msg_count", 0) or 0),
                weather=dd.weather,
                mood=dd.mood,
                space=dd.space,
            )
        )

    return DiaryQueryResponse(
        count=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(items) < total),
        took_ms=int((time.perf_counter() - started) * 1000),
        normalized=DiaryQueryNormalized(
            mode=q_mode_norm,
            syntax=q_syntax_norm,
            terms=terms,
            phrases=phrases,
            excludes=excludes,
        ),
        items=items,
    )


@router.put("/{diary_id}/bookmark", response_model=DiaryBookmarkItemResponse)
async def upsert_diary_bookmark(
    diary_id: int,
    req: DiaryBookmarkUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    if bool(req.bookmarked) is True:
        now_ms = int(time.time_ns() // 1_000_000)
        result = await db.execute(
            update(Diary)
            .where(Diary.id == diary_id, Diary.bookmarked_at.is_(None))
            .values(bookmarked_at=now_ms)
        )
        result_any = cast(Any, result)
        if int(getattr(result_any, "rowcount", 0) or 0) > 0:
            await db.commit()
    else:
        result = await db.execute(
            update(Diary)
            .where(Diary.id == diary_id, Diary.bookmarked_at.is_not(None))
            .values(bookmarked_at=None)
        )
        result_any = cast(Any, result)
        if int(getattr(result_any, "rowcount", 0) or 0) > 0:
            await db.commit()

    row = (
        await db.execute(
            select(Diary.id, Diary.bookmarked_at).where(Diary.id == diary_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Diary not found")
    _, bookmarked_at = row
    return DiaryBookmarkItemResponse(
        diary_id=int(diary_id), bookmarked_at=bookmarked_at
    )


@router.put("/bookmarks/batch", response_model=DiaryBookmarkBatchResponse)
async def upsert_diary_bookmarks_batch(
    req: DiaryBookmarkBatchUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    diary_ids: list[int] = []
    seen: set[int] = set()
    for raw in req.diary_ids:
        try:
            did = int(raw)
        except Exception:
            continue
        if did <= 0:
            continue
        if did in seen:
            continue
        seen.add(did)
        diary_ids.append(did)

    if not diary_ids:
        return DiaryBookmarkBatchResponse(updated=0, items=[])

    max_len = 200
    if len(diary_ids) > max_len:
        raise HTTPException(
            status_code=422,
            detail=f"diary_ids too large (max {max_len})",
        )

    updated = 0
    if bool(req.bookmarked) is True:
        now_ms = int(time.time_ns() // 1_000_000)
        result = await db.execute(
            update(Diary)
            .where(Diary.id.in_(diary_ids), Diary.bookmarked_at.is_(None))
            .values(bookmarked_at=now_ms)
        )
        result_any = cast(Any, result)
        updated = int(getattr(result_any, "rowcount", 0) or 0)
        if updated > 0:
            await db.commit()
    else:
        result = await db.execute(
            update(Diary)
            .where(Diary.id.in_(diary_ids), Diary.bookmarked_at.is_not(None))
            .values(bookmarked_at=None)
        )
        result_any = cast(Any, result)
        updated = int(getattr(result_any, "rowcount", 0) or 0)
        if updated > 0:
            await db.commit()

    rows = await db.execute(
        select(Diary.id, Diary.bookmarked_at).where(Diary.id.in_(diary_ids))
    )
    got = {int(did): bookmarked_at for did, bookmarked_at in rows.all()}
    items = [
        DiaryBookmarkItemResponse(diary_id=did, bookmarked_at=got[did])
        for did in diary_ids
        if did in got
    ]

    return DiaryBookmarkBatchResponse(updated=updated, items=items)


@router.get("/{diary_id}", response_model=DiaryDetailResponse)
async def get_diary(diary_id: int, db: AsyncSession = Depends(get_db)):
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
        diary_id_val = int(getattr(diary, "id", 0) or 0)
        content_val = cast(str | None, getattr(diary, "content", None))
        raw_attachments = await service.build_attachments_for_content(
            diary_id=diary_id_val,
            nideriji_userid=nideriji_userid,
            content=content_val,
        )
        attachments = DiaryAttachments.model_validate(raw_attachments)

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
    stripped = etag.strip('"')
    return stripped in [p.strip('"') for p in parts]


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
    auth_token = getattr(account, "auth_token", None) if account else None
    if not isinstance(auth_token, str) or not auth_token.strip():
        raise HTTPException(status_code=404, detail="Account token not found")

    user = await db.scalar(select(User).where(User.id == diary.user_id))
    nideriji_userid = getattr(user, "nideriji_userid", None)
    if not isinstance(nideriji_userid, int) or nideriji_userid <= 0:
        raise HTTPException(status_code=404, detail="User not found")

    service = ImageCacheService(db)
    record = await service.ensure_cached(
        auth_token=auth_token,
        nideriji_userid=nideriji_userid,
        image_id=image_id,
    )

    status = (
        (getattr(record, "fetch_status", None) or "").strip().lower() if record else ""
    )

    data = getattr(record, "data", None) if record else None
    if (
        status != "ok"
        or not record
        or not isinstance(data, (bytes, bytearray))
        or not data
    ):
        # 为了 `<img>` 体验更一致：无权限/不存在统一返回 404，让前端走 onError 占位。
        if status in {"forbidden", "not_found"}:
            raise HTTPException(status_code=404, detail="IMAGE_NOT_AVAILABLE")
        raise HTTPException(status_code=502, detail="IMAGE_FETCH_FAILED")

    sha256 = (record.sha256 or "").strip()
    etag = f'"{sha256}"' if sha256 else ""
    headers = {
        "Cache-Control": "private, max-age=31536000",
    }
    if etag:
        headers["ETag"] = etag

    if etag and _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)

    media_type = (record.content_type or "").strip() or "application/octet-stream"
    return Response(content=bytes(data), media_type=media_type, headers=headers)


@router.get("/by-account/{account_id}", response_model=list[DiaryResponse])
async def get_diaries_by_account(
    account_id: int, limit: int = 50, db: AsyncSession = Depends(get_db)
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

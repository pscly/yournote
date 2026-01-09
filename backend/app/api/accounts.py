"""账号管理 API"""

from __future__ import annotations

import requests
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Account, User
from ..schemas import AccountCreate, AccountResponse, TokenStatus, TokenValidateRequest
from ..services.collector import CollectorService
from ..services.background import schedule_account_sync
from ..utils.token import get_token_status

router = APIRouter(prefix="/accounts", tags=["accounts"])


async def _remote_validate_token(auth_token: str, *, db: AsyncSession) -> TokenStatus:
    """通过 nideriji sync 接口远程校验 token 是否可用。

    设计目标：
    - 不依赖本地 JWT 解析（解析不到 exp 也能校验）
    - 失败时给出可用于前端提示的 reason
    """
    collector = CollectorService(db)
    base = get_token_status(auth_token)
    checked_at = datetime.now(timezone.utc)

    try:
        await collector.fetch_nideriji_data(auth_token)
        if base.get("expired") is True:
            return TokenStatus(
                is_valid=False,
                expired=True,
                expires_at=base.get("expires_at"),
                checked_at=checked_at,
                reason="token 已过期",
            )
        return TokenStatus(
            is_valid=True,
            expired=bool(base.get("expired")),
            expires_at=base.get("expires_at"),
            checked_at=checked_at,
            reason=None,
        )
    except requests.HTTPError as e:
        status_code = getattr(getattr(e, "response", None), "status_code", None)
        reason = "服务端校验失败（token 无效或已失效）"
        if isinstance(status_code, int):
            reason = f"{reason} (HTTP {status_code})"
        return TokenStatus(
            is_valid=False,
            expired=bool(base.get("expired")),
            expires_at=base.get("expires_at"),
            checked_at=checked_at,
            reason=reason,
        )
    except Exception as e:
        return TokenStatus(
            is_valid=False,
            expired=bool(base.get("expired")),
            expires_at=base.get("expires_at"),
            checked_at=checked_at,
            reason=f"校验异常: {e}",
        )


def _build_account_response(
    account: Account,
    *,
    user_name: str | None,
    token_status: TokenStatus | None = None,
) -> AccountResponse:
    return AccountResponse(
        id=account.id,
        nideriji_userid=account.nideriji_userid,
        user_name=user_name,
        email=account.email,
        is_active=account.is_active,
        token_status=token_status or TokenStatus(**get_token_status(account.auth_token)),
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


@router.post("", response_model=AccountResponse)
async def create_account(
    account: AccountCreate,
    db: AsyncSession = Depends(get_db),
):
    """添加/更新账号（前端只需要提交 auth_token）。"""
    collector = CollectorService(db)

    try:
        rdata = await collector.fetch_nideriji_data(account.auth_token)
    except requests.HTTPError as e:
        status_code = getattr(getattr(e, "response", None), "status_code", None)
        detail = "Token 无效或已失效"
        if isinstance(status_code, int):
            detail = f"{detail} (HTTP {status_code})"
        raise HTTPException(status_code=400, detail=detail) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取账号信息失败: {e}") from e

    user_config = rdata.get("user_config") or {}
    nideriji_userid = user_config.get("userid")
    if not isinstance(nideriji_userid, int):
        raise HTTPException(status_code=500, detail="上游返回缺少 userid，无法创建账号")

    email = user_config.get("useremail")
    if email is not None and not isinstance(email, str):
        email = None

    user_name = user_config.get("name")
    if user_name is not None and not isinstance(user_name, str):
        user_name = None

    # 同一个用户重复添加时，视为“更新 token / 恢复账号”
    result = await db.execute(select(Account).where(Account.nideriji_userid == nideriji_userid))
    existing = result.scalar_one_or_none()

    # 这里已经成功打到上游，视为“远程校验通过”
    token_status = TokenStatus(**get_token_status(account.auth_token), checked_at=datetime.now(timezone.utc))

    if existing:
        existing.auth_token = account.auth_token
        existing.email = email
        existing.is_active = True
        await collector._save_user_info(user_config, existing.id)
        await db.commit()
        await db.refresh(existing)
        schedule_account_sync(existing.id)
        return _build_account_response(existing, user_name=user_name, token_status=token_status)

    new_account = Account(
        nideriji_userid=nideriji_userid,
        auth_token=account.auth_token,
        email=email,
        is_active=True,
    )
    db.add(new_account)
    await db.flush()
    await collector._save_user_info(user_config, new_account.id)
    await db.commit()
    await db.refresh(new_account)
    schedule_account_sync(new_account.id)
    return _build_account_response(new_account, user_name=user_name, token_status=token_status)


@router.get("", response_model=list[AccountResponse])
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """获取所有账号列表（只返回活跃账号）。"""
    result = await db.execute(select(Account).where(Account.is_active == True))
    accounts = result.scalars().all()

    nideriji_userids = [a.nideriji_userid for a in accounts]
    user_map: dict[int, User] = {}
    if nideriji_userids:
        users_result = await db.execute(select(User).where(User.nideriji_userid.in_(nideriji_userids)))
        user_map = {u.nideriji_userid: u for u in users_result.scalars().all()}

    responses: list[AccountResponse] = []
    for a in accounts:
        user = user_map.get(a.nideriji_userid)
        responses.append(_build_account_response(a, user_name=(user.name if user else None)))
    return responses


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """获取单个账号详情"""
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    user_result = await db.execute(select(User).where(User.nideriji_userid == account.nideriji_userid))
    user = user_result.scalar_one_or_none()
    return _build_account_response(account, user_name=(user.name if user else None))


@router.post("/validate-token", response_model=TokenStatus)
async def validate_token(
    body: TokenValidateRequest,
    db: AsyncSession = Depends(get_db),
):
    """远程校验任意 token（不落库）。"""
    return await _remote_validate_token(body.auth_token, db=db)


@router.post("/{account_id}/validate", response_model=TokenStatus)
async def validate_account_token(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """远程校验指定账号的 token（不落库）。"""
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    return await _remote_validate_token(account.auth_token, db=db)


@router.put("/{account_id}/token", response_model=AccountResponse)
async def update_account_token(
    account_id: int,
    body: TokenValidateRequest,
    db: AsyncSession = Depends(get_db),
):
    """更新指定账号的 token，并自动触发后台同步。

    安全约束：
    - 会先远程校验 token
    - 校验 token 对应的 userid 必须与该账号绑定的 nideriji_userid 一致
    """
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    collector = CollectorService(db)
    try:
        rdata = await collector.fetch_nideriji_data(body.auth_token)
    except requests.HTTPError as e:
        status_code = getattr(getattr(e, "response", None), "status_code", None)
        detail = "Token 无效或已失效"
        if isinstance(status_code, int):
            detail = f"{detail} (HTTP {status_code})"
        raise HTTPException(status_code=400, detail=detail) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取账号信息失败: {e}") from e

    user_config = rdata.get("user_config") or {}
    token_userid = user_config.get("userid")
    if not isinstance(token_userid, int):
        raise HTTPException(status_code=500, detail="上游返回缺少 userid，无法更新 token")

    if token_userid != account.nideriji_userid:
        raise HTTPException(
            status_code=400,
            detail=f"Token 用户不匹配：该账号 userid={account.nideriji_userid}，但 token 对应 userid={token_userid}",
        )

    email = user_config.get("useremail")
    if email is not None and not isinstance(email, str):
        email = None

    user_name = user_config.get("name")
    if user_name is not None and not isinstance(user_name, str):
        user_name = None

    account.auth_token = body.auth_token
    account.email = email
    account.is_active = True
    await collector._save_user_info(user_config, account.id)
    await db.commit()
    await db.refresh(account)

    schedule_account_sync(account.id)
    token_status = TokenStatus(
        **get_token_status(body.auth_token),
        checked_at=datetime.now(timezone.utc),
    )
    return _build_account_response(account, user_name=user_name, token_status=token_status)


@router.delete("/{account_id}")
async def delete_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """删除账号（软删除）"""
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    account.is_active = False
    await db.commit()
    return {"message": "Account deleted successfully"}

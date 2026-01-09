from datetime import datetime

from pydantic import BaseModel


class AccountCreate(BaseModel):
    """创建/更新账号的请求模型（只需要提供 token）。"""

    auth_token: str


class TokenStatus(BaseModel):
    """token 状态（目前仅判断是否过期）。"""

    is_valid: bool
    expired: bool
    expires_at: datetime | None = None
    checked_at: datetime | None = None
    reason: str | None = None


class TokenValidateRequest(BaseModel):
    """token 校验请求（服务端远程校验）。"""

    auth_token: str


class AccountResponse(BaseModel):
    """账号响应模型"""

    id: int
    nideriji_userid: int
    user_name: str | None = None
    email: str | None
    is_active: bool
    token_status: TokenStatus
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

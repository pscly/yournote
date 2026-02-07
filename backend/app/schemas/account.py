from datetime import datetime

from pydantic import BaseModel, Field


class AccountCreate(BaseModel):
    """创建/更新账号的请求模型（token 或 账号密码二选一）。

    约定：
    - 直接提供 token：auth_token
    - 账号密码登录：email + password（服务端会先调用 nideriji /api/login/ 获取 token）
    """

    auth_token: str | None = None
    email: str | None = None
    password: str | None = Field(default=None, repr=False)


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
    last_diary_ts: int | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AccountMetaResponse(BaseModel):
    """账号元数据响应模型（用于轻量展示/轮询）。

    设计目标：
    - 给同步指示器等高频请求使用，避免返回 token_status/时间戳等大字段
    - 降低后端序列化成本与网络传输体积
    """

    id: int
    nideriji_userid: int
    user_name: str | None = None


class AccountValidateBatchRequest(BaseModel):
    """批量校验账号 token 的请求。

    说明：
    - 用于前端“账号管理”页批量刷新 token 状态，减少 N 次请求带来的抖动。
    - 服务端会按账号执行远程校验；若 token 失效且账号保存了密码，会自动重新登录刷新 token。
    """

    account_ids: list[int] = Field(default_factory=list, description="需要校验的账号 ID 列表")


class AccountValidateBatchItemResponse(BaseModel):
    account_id: int
    token_status: TokenStatus


class AccountValidateBatchResponse(BaseModel):
    """批量校验响应：返回每个账号的 token_status。"""

    items: list[AccountValidateBatchItemResponse] = Field(default_factory=list)

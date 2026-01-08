from pydantic import BaseModel
from datetime import datetime


class AccountCreate(BaseModel):
    """创建账号的请求模型"""
    nideriji_userid: int
    auth_token: str
    email: str | None = None


class AccountResponse(BaseModel):
    """账号响应模型"""
    id: int
    nideriji_userid: int
    email: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

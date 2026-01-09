# YourNote Backend API

日记采集系统后端 API，支持多账号管理和数据同步。

## 快速开始

### 1. 安装依赖

```bash
cd F:\codes\yournote
uv sync
```

### 2. 配置环境变量

复制 `.env.example` 到 `.env` 并根据需要修改：

```bash
cp .env.example .env
```

### 3. 初始化数据库

```bash
cd backend
uv run python init_db.py
```

### 4. 启动服务

```bash
uv run python run.py
```

服务将在 http://localhost:8000 启动。

## API 文档

启动服务后，访问以下地址查看 API 文档：

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 主要功能

### 账号管理
- `POST /api/accounts` - 添加新账号
- `GET /api/accounts` - 获取账号列表
- `GET /api/accounts/{id}` - 获取账号详情
- `DELETE /api/accounts/{id}` - 删除账号

### 数据同步
- `POST /api/sync/trigger/{account_id}` - 触发同步
- `GET /api/sync/logs` - 获取同步历史

补充说明：同步时主要使用 `https://nideriji.cn/api/v2/sync/` 获取日记列表；当发现日记内容少于 100 个字（通常是 paired 公开日记的“简略内容”）时，后端会自动再调用 `https://nideriji.cn/api/diary/all_by_ids/{userid}/` 取一次完整内容，并且不会用短内容覆盖数据库中已存在的完整内容。

### 日记查询
- `GET /api/diaries` - 获取日记列表
- `GET /api/diaries/{id}` - 获取日记详情
- `GET /api/diaries/by-account/{account_id}` - 按账号查询
- `POST /api/diaries/{id}/refresh` - 强制刷新单条日记（返回 `diary + refresh_info`）

### 用户信息
- `GET /api/users` - 获取用户列表
- `GET /api/users/{id}` - 获取用户详情
- `GET /api/users/{id}/last-login` - 获取最后登录时间

## 使用示例

### 1. 添加账号

```bash
curl -X POST "http://localhost:8000/api/accounts" \
  -H "Content-Type: application/json" \
  -d '{
    "nideriji_userid": 460100,
    "auth_token": "token eyJhbGci...",
    "email": "your@email.com"
  }'
```

### 2. 触发数据同步

```bash
curl -X POST "http://localhost:8000/api/sync/trigger/1"
```

### 3. 查询日记

```bash
curl "http://localhost:8000/api/diaries?account_id=1&limit=10"
```

## 数据库

默认使用 SQLite，数据库文件位于 `yournote.db`。

如需切换到 PostgreSQL，修改 `.env` 文件中的 `DATABASE_URL`：

```
DATABASE_URL=postgresql+asyncpg://username:password@localhost:5432/yournote
```

## 项目结构

```
backend/
├── app/
│   ├── api/          # API 路由
│   ├── models/       # 数据库模型
│   ├── schemas/      # Pydantic 模型
│   ├── services/     # 业务逻辑
│   ├── config.py     # 配置
│   ├── database.py   # 数据库连接
│   └── main.py       # 应用入口
├── init_db.py        # 数据库初始化
└── run.py            # 启动脚本
```

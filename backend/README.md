# YourNote Backend API

日记采集系统后端 API，支持多账号管理和数据同步。

## 快速开始

### 1. 安装依赖

```bash
cd F:\codes\yournote
uv sync
```

### 2. 配置环境变量

复制仓库根目录的 `.env.example` 到 `.env` 并根据需要修改（前后端共用同一个 `.env`）：

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

服务默认在 http://localhost:31012 启动，可通过根目录 `.env` 中的 `BACKEND_PORT` 修改。

## API 文档

启动服务后，访问以下地址查看 API 文档：

- Swagger UI: http://localhost:31012/docs
- ReDoc: http://localhost:31012/redoc

## 主要功能

### 账号管理
- `POST /api/accounts` - 添加新账号（Token 或 账号密码二选一）
- `GET /api/accounts` - 获取账号列表     
- `GET /api/accounts/meta` - 获取账号元数据（轻量，适合高频轮询/展示）
- `GET /api/accounts/{id}` - 获取账号详情
- `DELETE /api/accounts/{id}` - 删除账号
- `POST /api/accounts/{id}/validate` - 远程校验账号 Token 是否可用
- `POST /api/accounts/validate-token` - 远程校验任意 Token（不落库）
- `PUT /api/accounts/{id}/token` - 更新指定账号 Token（校验 userid 匹配并自动触发同步）

### 数据同步
- `POST /api/sync/trigger/{account_id}` - 触发同步
- `GET /api/sync/logs` - 获取同步历史
- `GET /api/sync/logs/latest` - 获取每个账号最新一条同步日志（轻量，适合轮询）

补充说明：同步时主要使用 `https://nideriji.cn/api/v2/sync/` 获取日记列表；当发现日记内容少于 100 个字（通常是 paired 公开日记的“简略内容”）时，后端会自动再调用 `https://nideriji.cn/api/diary/all_by_ids/{userid}/` 取一次完整内容，并且不会用短内容覆盖数据库中已存在的完整内容。

### 日记查询
- `GET /api/diaries` - 获取日记列表
- `GET /api/diaries/{id}` - 获取日记详情
- `GET /api/diaries/by-account/{account_id}` - 按账号查询
- `POST /api/diaries/{id}/refresh` - 强制刷新单条日记（返回 `diary + refresh_info`）

### 发布日记（草稿/历史/批量发布）
说明：该功能用于“写作与一键发布”，其草稿与发布历史会单独存储，不会与采集到的 `Diary` 表混在一起。

- `GET /api/publish-diaries/draft/{date}` - 获取指定日期草稿（不存在则返回空草稿）
- `PUT /api/publish-diaries/draft/{date}` - 保存/更新指定日期草稿
- `POST /api/publish-diaries/publish` - 发布/更新指定日期日记（可选择多个账号）
- `GET /api/publish-diaries/runs` - 发布历史列表（支持按 `date` 过滤）
- `GET /api/publish-diaries/runs/{run_id}` - 查看一次发布详情（含每个账号结果）

### 用户信息
- `GET /api/users` - 获取用户列表
- `GET /api/users/{id}` - 获取用户详情
- `GET /api/users/{id}/last-login` - 获取最后登录时间

## 使用示例

### 1. 添加账号

推荐（账号密码登录）：后端会先登录换取 Token，并把账号密码保存在本地数据库中；后续 Token 过期时会自动重新登录并继续同步。

```bash
curl -X POST "http://localhost:31012/api/accounts" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "pscly@outlook.com",
    "password": "你的密码"
  }'
```

也可以直接提供 Token：

```bash
curl -X POST "http://localhost:31012/api/accounts" \
  -H "Content-Type: application/json" \
  -d '{
    "auth_token": "token eyJhbGci..."
  }'
```

说明：添加/更新账号成功后，后端会自动在后台触发一次同步（包含配对用户日记）。

### 2. 触发数据同步

```bash
curl -X POST "http://localhost:31012/api/sync/trigger/1"
```

### 3. 查询日记

```bash
curl "http://localhost:31012/api/diaries?account_id=1&limit=10"
```

## 数据库

默认使用 SQLite，数据库文件默认位于仓库根目录 `yournote.db`，可通过 `.env` 中的 `SQLITE_DB_PATH` 修改位置。

如需切换到 PostgreSQL，修改 `.env` 文件中的 `DATABASE_URL`（`DATABASE_URL` 会覆盖 `SQLITE_DB_PATH`）：

```
DATABASE_URL=postgresql+asyncpg://username:password@localhost:5432/yournote
```

### 从 PostgreSQL 迁移到本地 SQLite（开发用）

如果你当前在用远程 PostgreSQL，但想先切回本地 SQLite 开发，可以把数据迁移一份到本地：

```bash
cd backend
uv run python migrate_postgres_to_sqlite.py --overwrite
```

迁移完成后，编辑根目录 `.env`：

- 注释/删除 `DATABASE_URL`（避免后端继续连 PostgreSQL）
- 保留/设置 `SQLITE_DB_PATH=./yournote.db`

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

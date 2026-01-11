# YourNote

YourNote 是一个本地化的“日记采集 + 多账号同步 + 写作发布”工具，前后端分离：

- 后端：FastAPI + SQLAlchemy（异步）+ APScheduler
- 前端：React + Vite + Ant Design
- 数据库：默认 SQLite（可切 PostgreSQL）

## 快速开始（Windows）

### 1) 安装依赖

- Python：推荐使用 `uv`（仓库根目录已有 `.python-version`，默认 `3.13`）
- Node.js：用于运行前端（建议 Node.js 18+）

### 2) 配置环境变量

复制根目录的 `.env.example` 为 `.env`，按需修改端口/数据库等配置：

```bash
cp .env.example .env
```

### 3) 初始化数据库

```bash
cd backend
uv run python init_db.py
```

### 4) 启动项目

推荐一键启动（会分别启动前后端）：

```bat
启动项目.bat
```

或手动启动：

```bash
# 后端
cd backend
uv run python run.py

# 前端（另开终端）
cd frontend
npm run dev
```

## 文档与说明

- 后端：`backend/README.md`
- 前端：`frontend/README.md`

## 目录结构（概览）

```
backend/          后端工程
  app/            FastAPI 业务代码
frontend/         前端工程（React + Vite）
logs/             本地访问日志（按天落盘，默认开启）
```

## 配置要点（常用）

- 端口：`BACKEND_PORT` / `FRONTEND_PORT`
- 数据库：`SQLITE_DB_PATH`（推荐）或 `DATABASE_URL`（高级）
- API 前缀：`API_PREFIX`（前后端需一致）
- 访问密码：`PWD` / `ACCESS_*`（站点级门禁，未登录时所有 `/api/**` 返回 401）
- 同步：`SYNC_ON_STARTUP` / `SYNC_INTERVAL_MINUTES`        
- 跨域：`CORS_ALLOW_ORIGINS` / `CORS_ALLOW_CREDENTIALS`    
- 访问日志：`ACCESS_LOG_*`

## 工程规范（重要）

- 全仓库文本文件统一 UTF-8（无 BOM）
- 统一行尾：默认 LF；`*.bat`/`*.cmd` 使用 CRLF

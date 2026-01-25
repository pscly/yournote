# Docker Deployment (Frontend + Backend)

This repository ships `docker-compose.yml` for remote deployment and updates.
No PostgreSQL container is included (use SQLite by default, or point `DATABASE_URL` to an external PG).

---

## 中文说明（服务器一键部署/更新）

### 1) 准备配置

在服务器上进入仓库根目录，复制并编辑环境变量：

```bash
cp .env.example .env
```

说明：
- 本次 compose 会把 SQLite 落到宿主机 `./data/yournote.db`（不会污染仓库根目录，也方便持久化）。
- 访问日志会落到宿主机 `./logs/`（按天滚动）。
- 如需切换到远程 PostgreSQL：只需要在 `.env` 配置 `DATABASE_URL=postgresql+asyncpg://...`（本次不提供 pg 镜像）。

### 2) 启动（首次部署）

```bash
docker compose up -d --build
```

### 3) 更新（拉新代码后重建并滚动更新）

```bash
git pull
docker compose up -d --build
```

### 4) 常用命令

```bash
# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 停止（不删数据）
docker compose down
```

### 5) 访问方式

- 前端：`http://<服务器IP>:${FRONTEND_PORT:-31011}`
- 后端接口（通过前端 Nginx 同源反代）：`/api/*`
- 后端文档：`/docs`、`/redoc`


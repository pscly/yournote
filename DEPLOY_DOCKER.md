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

### 6) 网络/域名常见坑（IPv4 / IPv6）

如果你用域名访问，在某些网络（尤其是纯 IPv4 的 Wi‑Fi）里出现“域名解析失败 / 访问不到”，很多时候并不是服务挂了，而是**域名只有 AAAA（IPv6）记录**，没有 A（IPv4）记录。

建议：
- 尽量让域名同时具备 **A（IPv4）+ AAAA（IPv6）** 记录（双栈），兼容性最好。
- 自测方式：分别查询 `A` 与 `AAAA`（可用 `dig <域名> A`、`dig <域名> AAAA` 或在线 DNS 工具）。
- 如果上行没有公网 IPv4 / 处于 CGNAT：即使补了 A 记录，也可能无法从外网通过 IPv4 连入，需要 Cloudflare Tunnel / FRP / VPS 反代 等方案。

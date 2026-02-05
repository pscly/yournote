# YourNote Frontend（React + Vite）

YourNote 的前端项目，基于 React + Vite。

## 端口与访问

- 前端开发服务端口：根目录 `.env` 的 `FRONTEND_PORT`（默认 `31011`）
- 后端 API 端口：根目录 `.env` 的 `BACKEND_PORT`（默认 `31012`）
- 默认访问地址：
  - 前端：`http://localhost:<FRONTEND_PORT>`
  - 后端：`http://localhost:<BACKEND_PORT>`（Swagger：`http://localhost:<BACKEND_PORT>/docs`）

前端开发服务已配置为允许所有 IP 访问（监听 `0.0.0.0`）。在同一局域网内，其他设备可通过你电脑的局域网 IP 访问：

- `http://<你的电脑局域网IP>:<FRONTEND_PORT>`

## 启动方式

### 方式 1：一键启动（推荐）

在仓库根目录运行：

```bat
run.bat
```

### 方式 2：手动启动

前端：

```bash
cd frontend
npm run dev
```

后端（另开一个终端）：

```bash
cd backend
uv run python run.py
```

## API 访问方式（重要）

为避免跨设备访问时 `localhost` 指向错误的问题，前端默认使用同源地址：

- `frontend/src/config.js` 中 `API_BASE_URL` 默认为 `'/api'`
- `frontend/vite.config.js` 中配置了代理（会读取根目录 `.env`）：`<API_PREFIX> -> http://<BACKEND_HOST>:<BACKEND_PORT>`

如果你在后端修改了 `API_PREFIX`（例如改成 `/api2`），请同时在前端设置 `VITE_API_BASE_URL=/api2`，否则默认 `'/api'` 会与后端路由前缀不一致。

如果你希望前端直连某个固定后端地址（例如部署到服务器后），可以通过环境变量覆盖：

```bash
# 示例：让前端直连服务器后端
VITE_API_BASE_URL=http://<服务器IP>:31012/api
```

## 常见问题

### 局域网设备无法访问

通常是 Windows 防火墙未放行端口导致，需要放通入站 TCP：

- `FRONTEND_PORT`（前端，默认 `31011`）
- `BACKEND_PORT`（后端，默认 `31012`）

## 页面入口

- `记录列表`：查看采集到的记录（只读）
- `发布记录`：独立的写作面板，支持按日期保存草稿，并一键发布/更新到多个账号

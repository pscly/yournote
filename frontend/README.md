# YourNote Frontend（React + Vite）

YourNote 的前端项目，基于 React + Vite。

## 端口与访问

- 前端开发服务端口：`31011`
- 后端 API 端口：`31012`
- 默认访问地址：
  - 前端：`http://localhost:31011`
  - 后端：`http://localhost:31012`（Swagger：`http://localhost:31012/docs`）

前端开发服务已配置为允许所有 IP 访问（监听 `0.0.0.0`）。在同一局域网内，其他设备可通过你电脑的局域网 IP 访问：

- `http://<你的电脑局域网IP>:31011`

## 启动方式

### 方式 1：一键启动（推荐）

在仓库根目录运行：

```bat
启动项目.bat
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
- `frontend/vite.config.js` 中配置了代理：`/api -> http://localhost:31012`

如果你希望前端直连某个固定后端地址（例如部署到服务器后），可以通过环境变量覆盖：

```bash
# 示例：让前端直连服务器后端
VITE_API_BASE_URL=http://<服务器IP>:31012/api
```

## 常见问题

### 局域网设备无法访问

通常是 Windows 防火墙未放行端口导致，需要放通入站 TCP：

- `31011`（前端）
- `31012`（后端）

# YourNote 访问密码（方案 A：签名 Cookie，90 天有效）

## 1. 目标与边界
### 目标
- 给整个系统加一个“访问密码”门禁：首次输入正确密码后，90 天内无需再次输入。
- 在后端强制拦截未授权请求，确保“绕过前端也无法访问数据”。
- 前端提供友好引导：遇到未授权自动跳转到输入密码页面，并支持登录后回跳。

### 非目标（本次不做）
- 不做多用户账号体系/权限分级（只做站点级访问控制）。
- 不做可视化会话管理后台（如列出会话、踢下线）。

## 2. 总体架构（后端强制门禁 + 前端友好引导）
- **后端（强制）**：对所有 `/api/**` 请求做统一门禁校验；未通过直接返回 `401`。
- **前端（体验）**：
  - 页面加载/接口请求遇到 `401`（且错误码为 `ACCESS_REQUIRED`）时，跳转到 `/access`。
  - 登录成功后，回跳至用户原本要访问的页面。

> 关键原则：**门禁必须落在后端**，前端只是提升体验。

## 3. 配置设计（统一从仓库根目录 `.env` 读取）
结合现有 `backend/app/config.py` 的设计习惯，建议把访问密码相关配置放入 settings。

### 3.1 必需配置
- `ACCESS_ENABLED=true|false`
  - `true`：启用门禁
  - `false`：关闭门禁（本地开发/排障用）
- `ACCESS_SESSION_SECRET=<随机长字符串>`
  - 用于 HMAC 签名 Cookie token
  - **至少 32 字节随机**（推荐 Base64 文本）
- 访问密码（二选一）：
  - 推荐：`ACCESS_PASSWORD_HASH=<pbkdf2 格式>`
  - 兼容：`ACCESS_PASSWORD_PLAINTEXT=<明文>`（只建议临时使用）

### 3.2 建议配置
- `ACCESS_PASSWORD_VERSION=1`
  - 改密码后递增版本号，使旧 Cookie 全部失效（最实用的“一键踢下线”手段）
- `ACCESS_SESSION_DAYS=90`
  - 允许未来轻松调整有效期

### 3.3 可选配置（增强可运维性）
- `ACCESS_COOKIE_NAME=yournote_access`
- `ACCESS_COOKIE_SAMESITE=Lax|Strict`（默认 `Lax`）
- `ACCESS_COOKIE_SECURE=auto|true|false`（默认 `auto`）
- `ACCESS_WHITELIST_PATHS=/, /health, /api/access/login, /api/access/status, /api/access/logout`
- `ACCESS_RATE_LIMIT_WINDOW_SECONDS=300`（5 分钟）
- `ACCESS_RATE_LIMIT_MAX_ATTEMPTS=20`

## 4. 密码存储与校验（推荐 PBKDF2，无第三方依赖）
为了做到“安全 + 易部署”，建议默认使用 PBKDF2-HMAC-SHA256（Python 标准库即可）。

### 4.1 Hash 格式建议
- 存储格式：`pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>`
  - `iterations`：建议 210000（可配置，但先固定也行）
  - `salt`：16 或 32 字节随机

### 4.2 校验规则
- 登录时把用户输入密码用相同 salt+iterations 重新计算 hash，使用 `hmac.compare_digest` 常量时间比较。
- 严禁把明文密码写入任何日志。

### 4.3 失败策略（Fail-Closed）
- 若 `ACCESS_ENABLED=true` 但未配置密码（hash/plaintext 都没有）或未配置 `ACCESS_SESSION_SECRET`：
  - **推荐直接在启动时抛错**，让服务无法启动，避免“误开门”。

### 4.4 运维生成示例（写进文档/README 或 .env.example）
- 生成 `ACCESS_SESSION_SECRET`（PowerShell 7）：
  - `([Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)))`
- 生成 `ACCESS_PASSWORD_HASH`：
  - 方案：提供一个小脚本/命令（例如 `python -c ...`）输出 hash 字符串，复制到 `.env`。

## 5. 90 天会话：签名 Cookie Token 设计
目标：不引入 DB/Redis，仅靠 Cookie 自描述 + HMAC 签名即可验证。

### 5.1 Cookie 规格
- 名称：`ACCESS_COOKIE_NAME`（默认 `yournote_access`）
- 有效期：90 天
  - `Max-Age = 90 * 24 * 60 * 60 = 7776000`
  - 同步设置 `Expires`（兼容更多客户端）
- 属性：
  - `HttpOnly=true`：防止 XSS 读取
  - `SameSite=Lax`：默认即可有效降低 CSRF 风险（尤其是跨站 POST 表单）
  - `Secure`：
    - `auto`：若请求是 HTTPS（或识别 `X-Forwarded-Proto=https`）则置 `Secure=true`
    - 本地 HTTP 开发环境保持 `false`
  - `Path=/`：全站生效

### 5.2 Token 格式（建议）
- `token = <payload_b64url>.<sig_b64url>`
- `payload`（JSON）字段建议：
  - `v`：token 格式版本（便于未来升级）
  - `iat`：签发时间（unix 秒）
  - `exp`：过期时间（unix 秒）
  - `pwd_ver`：密码版本号（对应 `ACCESS_PASSWORD_VERSION`）

### 5.3 签名算法
- `sig = HMAC-SHA256(secret, payload_b64url)`
- 校验：
  - 解析 token 结构是否正确
  - 重新计算签名并用 `hmac.compare_digest` 比对
  - 校验 `exp >= now`
  - 校验 `pwd_ver == ACCESS_PASSWORD_VERSION`

### 5.4 失效与轮换策略
- 退出登录：清 Cookie（`Max-Age=0`）即可。
- 改密码后全体下线：
  - 优先递增 `ACCESS_PASSWORD_VERSION`
  - 或者轮换 `ACCESS_SESSION_SECRET`（更彻底，但会让全部会话立刻失效）

## 6. 后端实现计划（FastAPI）

### 6.1 新增工具模块（无第三方依赖）
- `backend/app/utils/access_token.py`
  - base64url 编码/解码（注意去掉 `=` padding 的兼容处理）
  - 生成 token：`issue_token(pwd_version, days)`
  - 校验 token：`verify_token(token) -> (ok, reason)`

### 6.2 新增 API 路由
- 新增 `backend/app/api/access.py`，挂到 `/api/access`：
  - `POST /login`
    - body：`{ "password": "..." }`
    - 成功：`204 No Content` + `Set-Cookie`
    - 失败：`401` + `{ "detail": "ACCESS_DENIED" }`
  - `POST /logout`
    - 成功：`204` + 清 Cookie
  - `GET /status`
    - 已登录：`200` + `{ "ok": true }`
    - 未登录：`401` + `{ "detail": "ACCESS_REQUIRED" }`

### 6.3 门禁中间件（强制拦截点）
- 新增 `backend/app/middleware/access_gate.py`（或同等位置）：
  - 仅对 `/api/**` 生效（避免干扰 `/`、`/health` 等）
  - 白名单路径（可配置）：
    - `/api/access/login`
    - `/api/access/logout`
    - `/api/access/status`
    - 以及必要的健康检查 `/_` 类路径
  - **放行 `OPTIONS`**（避免 CORS 预检被拦截）
  - 未授权统一返回：
    - `401` + `{ "detail": "ACCESS_REQUIRED" }`

> 备注：是否把“访问日志页面上报接口”加入白名单，需要根据你希望的行为决定。
> - 若要“未登录也记录 pageview”：加入白名单。
> - 若要“未登录完全不触达”：不加入白名单。

### 6.4 接入点（现有文件改动）
- `backend/app/config.py`
  - 新增 settings 字段与校验逻辑（启用时缺配置直接抛错）
- `backend/app/api/__init__.py`
  - 导出 `access_router`
- `backend/app/main.py`
  - 注册 `access_router`
  - 挂载门禁中间件

### 6.5 防暴力破解（建议默认开启，简单够用）
- 对 `POST /api/access/login` 做 IP 维度的滑动窗口限流：
  - 内存字典：`{ ip: [timestamps...] }`
  - 超过阈值返回 `429 Too Many Requests`
  - 只存最近窗口数据，定期清理（或按请求顺带清）

### 6.6 与现有 CORS/代理的兼容要点
- 现状：前端默认同源 `/api` + Vite proxy，多数情况下无需特殊处理。
- 若未来前端跨域直连后端：
  - axios 需要 `withCredentials=true`
  - 后端 CORS 必须把 `allow_origins` 改成明确域名列表（不能 `*`）

## 7. 前端实现计划（React + Vite + antd）

### 7.1 新增访问密码页面
- 新增 `frontend/src/pages/AccessGate.jsx`
  - antd `Form` + `Input.Password`
  - 提交调用 `POST /api/access/login`
  - 成功后读取 `redirect` 参数并跳转回去（默认 `/` 或仪表盘）

### 7.2 路由接入
- 在 `frontend/src/App.jsx` 增加路由：`/access`

### 7.3 统一拦截 401 并跳转
推荐以“axios 响应拦截器”为主（集中、改动点少）：
- 在 `frontend/src/services/api.js` 增加 `api.interceptors.response.use(...)`
  - 若响应 `401` 且 `detail === 'ACCESS_REQUIRED'`：
    - 记录当前 location（path+search）作为 `redirect`
    - 跳转到 `/access?redirect=...`
  - 注意排除：
    - `/access/login` 自己的请求，避免死循环
    - `/access/status` 的探测请求

可选增强：页面首屏探测
- 在 App 启动时请求一次 `/api/access/status`，提前决定是否需要显示门禁页面。

## 8. 测试计划
### 8.1 手工测试（必做）
- 未登录：访问任意业务页面 → 自动跳转 `/access`。
- 未登录：直接请求任意 `/api/*` 业务接口 → 返回 `401 + ACCESS_REQUIRED`。
- 登录成功：刷新页面/重启浏览器 → 90 天内仍可访问。
- 登录失败：不设置 Cookie，提示“密码错误”。
- 退出登录：Cookie 被清除，接口再次返回 401。
- 修改 `ACCESS_PASSWORD_VERSION`：旧 Cookie 立即失效。

### 8.2 自动化测试（可选）
- 使用现有 Playwright 基础设施：
  - 用例 1：未授权跳转门禁
  - 用例 2：登录后可进入仪表盘

## 9. 验收标准（Done Definition）
- 未输入访问密码时，任何业务 API 均不可访问（后端强制）。
- 输入正确密码后，浏览器在 90 天内无需再次输入。
- 登录接口具备基础防爆破能力（至少 IP 限流）。
- 变更密码版本号或 session secret 后，旧会话会自动失效。

## 10. 实施里程碑（按最小可用到可运维逐步推进）
1. 补齐后端 settings 与启动校验（fail-closed）。
2. 实现 token 工具 + `/api/access/*` 路由（login/logout/status）。
3. 接入门禁中间件，完成后端强制保护。
4. 前端新增 `/access` 页面 + 401 自动跳转与回跳。
5. 加入登录限流与必要的文档（`.env.example`/README）。
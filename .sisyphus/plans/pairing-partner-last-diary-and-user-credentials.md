# 配对列表展示对方最后日记时间 + 用户详情展示邮箱/密码（含遮罩）

## TL;DR

> **目标**：在 `/users` 的“配对视图”里，每条当前配对关系显示「配对时间」+「对方（pairedUser）最后一次日记时间」；在 `/user/:id` 用户详情里显示「用户名 + 邮箱 + 密码（默认遮罩，点击显示）」，无主账号则显示“无账号凭据”。
>
> **关键做法**：
> 1) 后端扩展 `GET /api/users/paired/{account_id}`：返回 `paired_user_last_diary_time`（取 `MAX(Diary.created_time)`，并在必要时 fallback 到 `created_date@00:00 Asia/Shanghai`）
> 2) 后端新增 `GET /api/users/{user_id}/credentials`：按 `Account.nideriji_userid == User.nideriji_userid` 返回 `email + login_password`
> 3) 前端：`AllUsers.jsx` 与 `UserDetail.jsx` 增量展示；密码默认遮罩+点击 reveal；无账号显示“无账号凭据”
>
> **测试策略**：不新增自动化测试文件；全部通过“执行代理 QA 场景”（curl + Playwright）验收。

**预计工作量**：中等（后端 2 个接口变更 + 前端 2 个页面改动）
**并行执行**：YES（后端与前端可并行，但接口字段需要对齐）
**关键路径**：后端接口字段完成 → 前端展示与交互 → QA 场景验证

---

## Context

### 原始需求（用户）
- 在“配对/关系列表”（现定位为 `/users` 的“配对视图”）中：所有用户都能看到「配对日期」与「对方最后一次日记日期」。现状只有“配对 2026/2/17 20:00:18”。
- 在用户详情（`/user/:id`）中：能看到用户名（邮箱）和密码。
- 安全说明：该工程由访问门禁保护，用户不担忧密码泄露；未来预留“访客密码不可见密码”（本次不实现）。

### 已确认决策
- “对方最后一次日记日期”口径：按“创建时间”为准；后端优先 `Diary.created_time`，必要时 fallback 到 `created_date`。
- 配对列表中“对方”定义：固定指 `pairedUser`（不是按“当前用户视角”动态切换）。
- 无日记文案：`暂无日记`。
- 日期格式：保持现状（前端用 `formatBeijingDateTime`，Asia/Shanghai，形如 `2026/2/17 20:00:18`）。
- 用户详情凭据来源：按 `Account.nideriji_userid == User.nideriji_userid` 匹配主账号显示。
- 若匹配不到主账号：显示“无账号凭据”。
- 用户详情展示：同时展示 `User.name` + `Account.email`。
- 本次不新增自动化测试文件；CI 不新增 test stage。

### 关键现状定位（供执行者快速上手）
- 前端配对/关系列表：`frontend/src/pages/AllUsers.jsx`
  - 路由：`frontend/src/App.jsx`（`/users` → `AllUsers`）
  - 当前配对关系渲染：`Tag` 文本 `配对 {formatShortTime(item.pairedTime)}`（`AllUsers.jsx:249-251`）
- 前端用户详情：`frontend/src/pages/UserDetail.jsx`
  - 路由：`frontend/src/App.jsx`（`/user/:id` → `UserDetail`）
  - 当前仅展示 `UserResponse` 字段；没有 email/password
- 后端配对接口：`backend/app/api/users.py` → `GET /api/users/paired/{account_id}`
- 日记表字段：`backend/app/models/diary.py`（`user_id`, `account_id`, `created_date`, `created_time`, `ts`）
- 账号凭据存储：`backend/app/models/account.py`（`email`, `login_password` 为明文 Text）
- 前端 API 封装：`frontend/src/services/api.js`（`userAPI.paired`, `userAPI.get`, `accountAPI.list` 等）

---

## Work Objectives

### Core Objective
用最小增量改动，把“配对时间 + 对方最后日记时间”补齐到配对视图，同时在用户详情安全地展示主账号邮箱/密码（默认遮罩），并为未来 guest-mode 预留扩展位。

### Scope
- IN:
  - `/users` 配对视图：新增展示对方最后日记时间
  - `/user/:id` 详情页：新增展示邮箱/密码（遮罩+点击显示），无账号提示
  - 后端扩展配对接口字段；新增用户凭据接口
- OUT:
  - 不实现“访客密码不可见密码”的真实权限控制（仅预留字段/结构）
  - 不改 CI（不加 test stage/job）
  - 不重构当前前端按账号 N 次请求 `userAPI.paired` 的整体加载策略（本次只复用其链路）

---

## Verification Strategy（强制：执行代理可验证，零人工）

本计划不新增测试文件，但每个任务都必须有可执行的 QA 场景：
- API 层：`curl` 请求 + JSON 断言（可用 `python - <<'PY'` 或 `jq`）
- UI 层：Playwright 打开页面、断言 DOM 文本、截图保存到 `.sisyphus/evidence/`

---

## Execution Strategy

Wave 1（可并行开始）
- Task 1：后端扩展配对接口返回对方 last diary time
- Task 3：后端新增用户凭据接口（email/password）

Wave 2（依赖 Wave 1 返回字段/接口稳定）
- Task 2：前端 `/users` 配对视图展示对方 last diary time
- Task 4：前端 `/user/:id` 展示邮箱/密码（遮罩+点击显示）

Wave 3（集成验收）
- Task 5：端到端 QA 场景（API + UI），留存证据

---

## TODOs

### 1) 后端：`/api/users/paired/{account_id}` 增加对方 last diary 字段

**What to do**
- 在 `backend/app/api/users.py` 的 `get_paired_users()` 内，基于当前 `relationships` 的 `paired_user_id` 集合，按 `account_id` 聚合查询该 account 下每个 user 的“最后一次日记时间”。
- 聚合口径：
  - 优先取 `MAX(Diary.created_time)`
  - 同时取 `MAX(Diary.created_date)`
  - 对每个 user_id，计算 `effective_last = max(created_time_max, created_date_max@00:00 Asia/Shanghai)`（两者存在时取更晚者）
  - 返回 `null` 表示“暂无日记”
- 在每条关系的响应 dict 中新增字段（强语义命名，避免前端误读）：
  - `paired_user_last_diary_time`（datetime | null）
  - `paired_user_last_diary_source`（`created_time` | `created_date` | null，便于排查）

**Must NOT do**
- 不要把此字段塞进 `UserResponse`（避免影响其他 API/页面）；字段应只存在于配对接口返回。
- 不要改动账号列表 `/api/accounts` 的响应去携带 user 维度 last diary（避免扩散）。

**Recommended Agent Profile**
- Category：`unspecified-high`
- Skills：无

**Parallelization**
- Can Run In Parallel：YES（与 Task 3 并行）
- Blocks：Task 2

**References**
- `backend/app/api/users.py`：`get_paired_users()`（现有 paired_time + user/paired_user 组装处）
- `backend/app/models/diary.py`：确认 `Diary.user_id/account_id/created_time/created_date` 字段
- `backend/app/api/accounts.py`：参考已有 `MAX(Diary.ts)` 的聚合写法与 AsyncSession.execute 风格

**Acceptance Criteria（API 可执行）**
- [x] 启动后端后执行：
  - `curl -s http://localhost:${BACKEND_PORT:-31012}/api/accounts` 能拿到至少一个 `id`（accountId）
  - `curl -s "http://localhost:${BACKEND_PORT:-31012}/api/users/paired/{accountId}?include_inactive=true"` 返回数组
  - 数组元素包含：`paired_time`、`user`、`paired_user`、`paired_user_last_diary_time`、`paired_user_last_diary_source`
- [x] 当对方无日记时：`paired_user_last_diary_time == null` 且 `paired_user_last_diary_source == null`

**可直接复制执行的验证命令（推荐，避免手工替换 accountId）**
```bash
mkdir -p .sisyphus/evidence

BACKEND_PORT=${BACKEND_PORT:-31012}

# 若启用了站点门禁：先用 /api/access/login 拿到 Cookie（全程用同一个 cookie jar）
cookie_jar=.sisyphus/evidence/access.cookies
: > "${cookie_jar}"
status_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${BACKEND_PORT}/api/access/status")
if [ "${status_code}" = "401" ]; then
  python - <<'PY'
import hashlib,os
from pathlib import Path

env = {}
env_path = Path('.env')
if env_path.exists():
  for line in env_path.read_text(encoding='utf-8').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line:
      continue
    k,v=line.split('=',1)
    env[k.strip()] = v.strip().strip('"').strip("'")

plain = env.get('PWD') or env.get('ACCESS_PASSWORD_PLAINTEXT') or ''
if not plain:
  raise SystemExit('ACCESS gate enabled but PWD/ACCESS_PASSWORD_PLAINTEXT not found in .env')

print(hashlib.sha256(plain.encode('utf-8')).hexdigest())
PY
  | python - <<'PY'
import json,sys
pwd_hash=sys.stdin.read().strip()
print(json.dumps({"password_hash": pwd_hash}))
PY
  | curl -s -X POST "http://localhost:${BACKEND_PORT}/api/access/login" \
      -H 'Content-Type: application/json' \
      -c "${cookie_jar}" \
      -d @- \
      -o /dev/null -w "login_status=%{http_code}\n"
fi

account_id=$(curl -s -b "${cookie_jar}" "http://localhost:${BACKEND_PORT}/api/accounts" | python - <<'PY'
import json,sys
data=json.load(sys.stdin)
print(data[0]["id"] if data and isinstance(data,list) and "id" in data[0] else "")
PY
)

curl -s -b "${cookie_jar}" "http://localhost:${BACKEND_PORT}/api/users/paired/${account_id}?include_inactive=true" \
  | tee .sisyphus/evidence/api-paired-with-last-diary.json \
  | python - <<'PY'
import json,sys
data=json.load(sys.stdin)
assert isinstance(data,list)
if data:
  k=data[0].keys()
  assert "paired_user_last_diary_time" in k
  assert "paired_user_last_diary_source" in k
print("OK")
PY
```

**Agent-Executed QA Scenario（Bash/curl）**
```
Scenario: 配对接口返回对方最后日记时间字段
  Tool: Bash (curl + python)
  Preconditions: 后端运行在 localhost:${BACKEND_PORT}; 门禁已通过（如开启）
  Steps:
    1. GET /api/accounts -> 取第一个 accountId
    2. GET /api/users/paired/{accountId}?include_inactive=true
    3. 断言：每个元素都包含键 paired_user_last_diary_time / paired_user_last_diary_source
  Expected Result: 字段存在且为 ISO 时间字符串或 null
  Evidence: 将响应保存为 .sisyphus/evidence/api-paired-with-last-diary.json
```

---

### 2) 前端：`/users` 配对视图新增展示“对方最后日记时间”

**What to do**
- 在 `frontend/src/pages/AllUsers.jsx`：
  - `loadData()` 构造 `nextActivePairs` 时，从 `latestActive` 读取后端新字段 `paired_user_last_diary_time`，映射到 `pairedUserLastDiaryTime`。
  - 在“当前配对关系” `renderItem`（`AllUsers.jsx:231` 附近）在现有“配对时间 Tag”旁新增一个 Tag：
    - 文案：`对方最后日记 {formatShortTime(item.pairedUserLastDiaryTime)}`
    - 若为空：显示 `对方最后日记 暂无日记`
  - 保持现有日期格式化链路（`formatShortTime` / `formatBeijingDateTime`）。

**Must NOT do**
- 不要改动“全部用户”Tab 的卡片布局（除非你确认用户也要在那里显示该字段；本次范围先锁在配对视图）。

**Recommended Agent Profile**
- Category：`quick`
- Skills：无

**Parallelization**
- Can Run In Parallel：NO（依赖 Task 1 字段落地）
- Blocked By：Task 1

**References**
- `frontend/src/pages/AllUsers.jsx:249-251`：现有“配对 {时间}” Tag 插入点
- `frontend/src/utils/time.js`：时间解析与北京时间格式化
- `frontend/src/services/api.js`：`userAPI.paired()` 返回的字段命名（snake_case）

**Acceptance Criteria（UI 可执行）**
- [x] 在 `/users` → “配对视图” → “当前配对关系”列表中：每条 active pair 显示两个 Tag：
  - `配对 <时间>`
  - `对方最后日记 <时间|暂无日记>`

**Agent-Executed QA Scenario（Playwright）**
```
Scenario: /users 配对视图显示对方最后日记时间
  Tool: Playwright (playwright skill)
  Preconditions: 前后端已启动；可访问 http://localhost:${FRONTEND_PORT:-31011}；若启用站点门禁，执行代理需从根目录 `.env` 读取 `PWD` 并在 /access 页自动填写
  Steps:
    1. 打开 http://localhost:${FRONTEND_PORT:-31011}/users
    1.1 若自动跳转到 /access：填写密码并提交，然后回到 /users
    2. 点击 Tab: 文本包含 "配对视图"（若默认已在该 Tab 则跳过）
    3. 等待列表出现：`.ant-tabs-tabpane-active .ant-list-item` 至少 1 条（timeout 10s）
    4. 断言：第一条列表项文本包含 "配对"
    5. 断言：第一条列表项文本包含 "对方最后日记"
    6. 截图：.sisyphus/evidence/ui-users-paired-last-diary.png
  Expected Result: 文案与 Tag 同时出现
  Evidence: .sisyphus/evidence/ui-users-paired-last-diary.png
```

---

### 3) 后端：新增 `GET /api/users/{user_id}/credentials`（邮箱/密码）

**What to do**
- 新增接口：`GET /api/users/{user_id}/credentials`
- 查询逻辑：
  1) 先查 `User.id == user_id`（不存在 → 404）
  2) 用 `user.nideriji_userid` 匹配 `Account.nideriji_userid`，取该 account 的 `email` 与 `login_password`
  3) 若无匹配 account → 返回 `has_account=false`（200），便于前端展示“无账号凭据”
- 响应建议（为未来 guest-mode 预留字段，但现在固定允许查看）：
  - `has_account: bool`
  - `email: string | null`
  - `can_view_password: bool`（现在 true）
  - `password_masked: string | null`（例如 `******`）
  - `password: string | null`（存在则为明文）

**Must NOT do**
- 不要把 `login_password` 加进 `AccountResponse` 或 `/api/accounts` 列表响应（避免明文密码扩散）。

**Recommended Agent Profile**
- Category：`unspecified-high`
- Skills：无

**Parallelization**
- Can Run In Parallel：YES（与 Task 1 并行）
- Blocks：Task 4

**References**
- `backend/app/models/account.py`：`login_password` 存储字段
- `backend/app/api/users.py`：现有 users router，可在同文件新增子路由
- `backend/app/middleware/access_gate.py`：确认该敏感接口仍受站点门禁保护

**Acceptance Criteria（API 可执行）**
- [x] `GET /api/users/{id}/credentials`：
  - 若该 user 有对应 account：返回 `has_account=true` 且 `email` 非空（或为 null）并包含 `password`（可能为 null）
  - 若无对应 account：返回 `has_account=false`，且 `password == null`

---

### 4) 前端：`/user/:id` 展示邮箱/密码（遮罩+点击显示）

**What to do**
- 在 `frontend/src/services/api.js` 的 `userAPI` 增加方法：`credentials(id)` → `GET /users/${id}/credentials`
- 在 `frontend/src/pages/UserDetail.jsx`：
  - 新增 state：`credentials`（含 `has_account/email/password/can_view_password`）与 `showPassword`（默认 false）
  - `loadData()` 中在拿到 user 后请求 credentials（可与 diaries 并行；若接口 404/失败，按“无账号凭据”处理）
  - `Descriptions` 增加两项：
    - `邮箱`：展示 credentials.email（空则 `-`）
    - `密码`：
      - 若 `has_account=false`：展示 `无账号凭据`
      - 否则：默认显示 `******` + 一个“显示/隐藏”按钮；点击切换明文/遮罩
      - 可选：提供复制按钮（建议用 `Typography.Text copyable`，但不要在 UI 上自动展示/日志输出明文）

**UI 约定（便于 QA 精准定位）**
- 密码切换按钮文案建议固定为：`显示密码` / `隐藏密码`（避免只用“显示/隐藏”造成歧义）

**Recommended Agent Profile**
- Category：`quick`
- Skills：无

**Parallelization**
- Can Run In Parallel：NO（依赖 Task 3 接口）
- Blocked By：Task 3

**References**
- `frontend/src/pages/UserDetail.jsx:156-168`：现有“用户信息” Descriptions 插入点
- `frontend/src/services/api.js:112-117`：userAPI 定义

**Acceptance Criteria（UI 可执行）**
- [x] 有账号的用户详情页：
  - 显示 `用户名`（User.name）
  - 显示 `邮箱`（Account.email）
  - `密码` 默认显示 `******`
  - 点击“显示”后出现明文密码；再次点击恢复 `******`
- [x] 无账号的用户详情页：`密码` 行显示 `无账号凭据`

**Agent-Executed QA Scenario（Playwright）**
```
Scenario: /user/:id 密码默认遮罩并可点击显示
  Tool: Playwright (playwright skill)
  Preconditions: 前后端已启动；若启用站点门禁，执行代理需从根目录 `.env` 读取 `PWD` 并在 /access 页自动填写
  Steps:
    1. 打开 http://localhost:${FRONTEND_PORT:-31011}/users
    1.1 若自动跳转到 /access：填写密码并提交，然后回到 /users
    2. 在配对视图列表中点击任意用户 Tag（进入 /user/:id）
    3. 等待：页面出现 "用户信息" 卡片（timeout 10s）
    4. 断言：页面包含 "邮箱"
    5. 断言：页面包含 "密码"
    6. 断言：初始状态密码显示为 "******"
    7. 点击按钮：文本为 "显示密码"
    8. 断言：密码明文出现（且不等于 ******）
    9. 再次点击按钮：文本为 "隐藏密码"
    10. 断言：密码回到 "******"
    11. 截图：.sisyphus/evidence/ui-user-detail-password-toggle.png
  Expected Result: 交互切换成功
  Evidence: .sisyphus/evidence/ui-user-detail-password-toggle.png
```

---

### 5) 集成 QA：接口 + UI 全链路验收（留证据）

**What to do**
- 执行 Task 1-4 后，跑一轮 API + UI 的场景组合，确保：
  - `/api/users/paired/{accountId}` 中字段存在且 UI 能展示
  - `/api/users/{id}/credentials` 能驱动 UI 的邮箱/密码渲染与点击 reveal

**Acceptance Criteria**
- [x] `.sisyphus/evidence/api-paired-with-last-diary.json` 存在且包含新增字段
- [x] `.sisyphus/evidence/ui-users-paired-last-diary.png` 存在
- [x] `.sisyphus/evidence/ui-user-detail-password-toggle.png` 存在

---

## Commit Strategy（建议）
- Commit 1（后端）：`feat(api): expose paired user's last diary time and credentials endpoint`
- Commit 2（前端）：`feat(ui): show partner last diary time and revealable password in user detail`

---

## Success Criteria

最终交付满足：
- `/users` 配对视图：每条当前配对关系同时显示“配对时间”和“对方最后日记时间/暂无日记”。
- `/user/:id`：展示用户名+邮箱+密码（默认遮罩，点击显示/隐藏），无账号时显示“无账号凭据”。
- 不引入额外测试文件；证据截图/响应落盘在 `.sisyphus/evidence/`。

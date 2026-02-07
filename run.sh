#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"

mkdir -p "$RUN_DIR"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

is_running_pid() {
  local pid="$1"
  if [[ -z "${pid}" ]]; then
    return 1
  fi
  kill -0 "${pid}" >/dev/null 2>&1
}

start_backend() {
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    local existing
    existing="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if is_running_pid "$existing"; then
      echo "[run.sh] 后端已在运行（pid=${existing}）"
      return 0
    fi
  fi

  echo "[run.sh] 启动后端（uv + FastAPI）..."
  (
    cd "$ROOT_DIR/backend"
    exec uv run python run.py
  ) &
  local pid=$!
  echo "$pid" > "$BACKEND_PID_FILE"
  echo "[run.sh] 后端已启动（pid=${pid}）"
}

start_frontend() {
  if [[ -f "$FRONTEND_PID_FILE" ]]; then
    local existing
    existing="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"
    if is_running_pid "$existing"; then
      echo "[run.sh] 前端已在运行（pid=${existing}）"
      return 0
    fi
  fi

  echo "[run.sh] 启动前端（Vite）..."
  (
    cd "$ROOT_DIR/frontend"
    exec npm run dev
  ) &
  local pid=$!
  echo "$pid" > "$FRONTEND_PID_FILE"
  echo "[run.sh] 前端已启动（pid=${pid}）"
}

cleanup() {
  # 仅在前台运行时（Ctrl+C）做“尽量优雅”的停止：避免留下一堆孤儿进程
  local bp=""
  local fp=""

  bp="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
  fp="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"

  if is_running_pid "$fp"; then
    echo "[run.sh] 停止前端（pid=${fp}）..."
    kill "$fp" >/dev/null 2>&1 || true
  fi
  if is_running_pid "$bp"; then
    echo "[run.sh] 停止后端（pid=${bp}）..."
    kill "$bp" >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM

start_backend
start_frontend

echo
echo "[run.sh] 已启动。你可以："
echo "  - 访问前端： http://localhost:\${FRONTEND_PORT:-31011}"
echo "  - 访问后端： http://localhost:\${BACKEND_PORT:-31012} （Swagger: /docs）"
echo "  - 另开终端执行： ./stop.sh  停止服务"
echo "  - 或在本窗口 Ctrl+C 停止（会尽量优雅退出）"
echo

# 前台等待：只要任一进程退出，就结束脚本（并由 trap 尝试清理）
set +e
backend_pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
frontend_pid="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"

while true; do
  if [[ -n "$backend_pid" ]] && ! is_running_pid "$backend_pid"; then
    echo "[run.sh] 后端进程已退出（pid=${backend_pid}）"
    break
  fi
  if [[ -n "$frontend_pid" ]] && ! is_running_pid "$frontend_pid"; then
    echo "[run.sh] 前端进程已退出（pid=${frontend_pid}）"
    break
  fi
  sleep 1
done


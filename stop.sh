#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

is_running_pid() {
  local pid="$1"
  if [[ -z "${pid}" ]]; then
    return 1
  fi
  kill -0 "${pid}" >/dev/null 2>&1
}

stop_pid() {
  local name="$1"
  local pid="$2"

  if ! is_running_pid "$pid"; then
    echo "[stop.sh] ${name} 未在运行（pid=${pid}）"
    return 0
  fi

  echo "[stop.sh] 停止 ${name}（pid=${pid}）..."
  kill "$pid" >/dev/null 2>&1 || true

  # 最多等待 8 秒优雅退出
  for _ in {1..16}; do
    if ! is_running_pid "$pid"; then
      echo "[stop.sh] ${name} 已停止"
      return 0
    fi
    sleep 0.5
  done

  echo "[stop.sh] ${name} 未退出，执行强制结束（kill -9）"
  kill -9 "$pid" >/dev/null 2>&1 || true
}

backend_pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
frontend_pid="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"

if [[ -n "$frontend_pid" ]]; then
  stop_pid "前端" "$frontend_pid"
  rm -f "$FRONTEND_PID_FILE"
else
  echo "[stop.sh] 未找到前端 pid 文件：${FRONTEND_PID_FILE}"
fi

if [[ -n "$backend_pid" ]]; then
  stop_pid "后端" "$backend_pid"
  rm -f "$BACKEND_PID_FILE"
else
  echo "[stop.sh] 未找到后端 pid 文件：${BACKEND_PID_FILE}"
fi

echo "[stop.sh] 完成"


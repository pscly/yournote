import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function normalizeApiPrefix(value) {
  const v = String(value ?? '/api').trim()
  if (!v) return '/api'
  return v.startsWith('/') ? v : `/${v}`
}

function normalizeBackendProxyHost(value) {
  const v = String(value ?? '').trim()
  if (!v) return '127.0.0.1'

  // 说明：
  // - 0.0.0.0 / :: 通常用于“服务端监听所有网卡”，但作为“客户端连接目标”并不合理；
  // - 前端 dev server（Vite proxy）应当连接到一个可访问的具体地址（通常是 127.0.0.1）。
  if (v === '0.0.0.0' || v === '::') return '127.0.0.1'
  return v
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 统一从仓库根目录读取 .env（避免 `cd frontend` 导致默认只在 frontend/ 下找 .env）
  const env = loadEnv(mode, repoRoot, '')

  const frontendPort = toInt(env.FRONTEND_PORT, 31011)
  const backendPort = toInt(env.BACKEND_PORT, 31012)
  const backendHost = normalizeBackendProxyHost(env.BACKEND_PROXY_HOST || env.BACKEND_HOST)
  const apiPrefix = normalizeApiPrefix(env.API_PREFIX)

  return {
    plugins: [react()],
    server: {
      host: true,
      allowedHosts: ['2.pscly.cn'],
      port: frontendPort,
      strictPort: true,
      proxy: {
        [apiPrefix]: {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})

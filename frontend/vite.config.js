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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 统一从仓库根目录读取 .env（避免 `cd frontend` 导致默认只在 frontend/ 下找 .env）
  const env = loadEnv(mode, repoRoot, '')

  const frontendPort = toInt(env.FRONTEND_PORT, 31011)
  const backendPort = toInt(env.BACKEND_PORT, 31012)
  const backendHost = env.BACKEND_HOST || 'localhost'
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

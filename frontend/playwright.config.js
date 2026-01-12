import { defineConfig } from '@playwright/test'
import { loadEnv } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

// Playwright 运行目录通常在 frontend/，这里同样统一读取根目录 .env
const env = loadEnv('development', repoRoot, '')
const frontendPort = toInt(env.FRONTEND_PORT, 31011)
const baseURL = `http://localhost:${frontendPort}`

// 可选：把门禁密码透传给测试用例（不写入代码/日志，测试里仅用于自动填写登录表单）
// 注意：这里优先使用 ACCESS_PASSWORD_PLAINTEXT，避免与系统环境变量 PWD 冲突。
if (!process.env.ACCESS_PASSWORD_PLAINTEXT) {
  const pwd = String(env.ACCESS_PASSWORD_PLAINTEXT ?? '').trim()
  if (pwd) process.env.ACCESS_PASSWORD_PLAINTEXT = pwd
}

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
  },
})

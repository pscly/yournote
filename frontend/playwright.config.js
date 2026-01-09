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

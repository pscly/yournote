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

// 测试环境兼容：
// - 某些环境会设置 http_proxy/https_proxy，导致 Playwright 的 webServer 可用性探测被代理“误判”
// - 这里显式补齐 NO_PROXY / no_proxy，确保 localhost 走直连
const ensureNoProxyHosts = (value) => {
  const base = String(value ?? '').trim()
  const parts = base ? base.split(',').map((v) => v.trim()).filter(Boolean) : []
  const set = new Set(parts.map((v) => v.toLowerCase()))
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    if (!set.has(host)) parts.push(host)
  }
  return parts.join(',')
}

process.env.NO_PROXY = ensureNoProxyHosts(process.env.NO_PROXY)
process.env.no_proxy = ensureNoProxyHosts(process.env.no_proxy)

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
    // 测试环境（沙箱）下可能禁止绑定 0.0.0.0；这里显式用 127.0.0.1，避免 EPERM
    command: 'npm run dev -- --host 127.0.0.1',
    url: baseURL,
    reuseExistingServer: true,
  },
})

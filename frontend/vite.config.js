import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['2.pscly.cn'],
    port: 31011,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:31012',
        changeOrigin: true,
      },
    },
  },
})

/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Same-origin /api keeps the session cookie first-party in dev.
  server: { proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:8000' } },
  test: { include: ['src/**/*.test.ts'] }, // e2e/ is Playwright's
})

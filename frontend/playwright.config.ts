import { defineConfig } from '@playwright/test'

// Separate ports and a throwaway SQLite DB so e2e runs never touch the dev servers or data.
const API_PORT = 8100
const WEB_PORT = 5180
const WEB = `http://localhost:${WEB_PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: WEB,
    // Locally use the installed Chrome (no browser download); CI installs Chromium.
    ...(process.env.CI ? {} : { channel: 'chrome' }),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        `rm -rf e2e/.tmp && mkdir -p e2e/.tmp && cd ../backend && ` +
        `DATABASE_URL=sqlite:///../frontend/e2e/.tmp/e2e.db DEV_LOGIN=1 FRONTEND_URL=${WEB} ` +
        `${process.env.PYTHON ?? '.venv/bin/python'} -m uvicorn app.main:app --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}/api/platforms`,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: { API_PROXY: `http://localhost:${API_PORT}` },
      url: WEB,
      reuseExistingServer: false,
    },
  ],
})

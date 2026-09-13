import { defineConfig, devices } from '@playwright/test'
import { loadEnvConfig } from '@next/env'

// Playwright's Node process does not read .env/.env.local the way `next`
// does; load them here so E2E_* credentials (and any backend env) are
// available to specs without exporting shell variables.
loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} })

const externalBaseURL = process.env.E2E_BASE_URL?.trim()
const baseURL = externalBaseURL || 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: 'node -e "require(\'@next/env\').loadEnvConfig(process.cwd()); require(\'./.next/standalone/server.js\')"',
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120000,
        },
      }),
})

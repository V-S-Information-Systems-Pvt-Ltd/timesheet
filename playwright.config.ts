import { defineConfig, devices } from '@playwright/test'
import { loadEnvConfig } from '@next/env'

// Playwright's Node process does not read .env/.env.local the way `next`
// does; load them here so E2E_* credentials (and any backend env) are
// available to specs without exporting shell variables.
loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} })

const externalBaseURL = process.env.E2E_BASE_URL?.trim()
const baseURL = externalBaseURL || 'http://localhost:3000'
const fixtureSpecs = /(bounded-dashboard|timesheet-mutations|ui-polish)\.spec\.ts$/

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      // Fully mocked by browser-fixture.ts: no real session, safe to parallelize.
      name: 'fixture',
      testMatch: fixtureSpecs,
      fullyParallel: true,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Specs share one E2E account, and logout bumps its session_version, which
      // signs out every other browser session. Parallel workers would log each
      // other out mid-test.
      name: 'live',
      testIgnore: fixtureSpecs,
      workers: 1,
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

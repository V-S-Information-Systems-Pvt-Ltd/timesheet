// e2e/smoke.spec.ts
// Critical-path smoke tests for the VSIS Timesheet: login, dashboard load,
// and logout.

import { test, expect } from '@playwright/test'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var ${name} for e2e tests. See .env.example.`)
  return value
}

test.describe('Critical paths', () => {
  test('homepage loads and shows login', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Sign in')).toBeVisible()
  })

  test('dashboard loads for authenticated user and logs out', async ({ page }) => {
    const email = required('E2E_EMAIL')
    const password = required('E2E_PASSWORD')

    await page.goto('/')
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await expect(page.locator('text=Welcome back')).toBeVisible({ timeout: 15000 })

    // Logout returns to the sign-in screen (covers the logout journey).
    await page.click('text=Logout')
    await expect(page.locator('text=Sign in')).toBeVisible({ timeout: 15000 })
  })
})

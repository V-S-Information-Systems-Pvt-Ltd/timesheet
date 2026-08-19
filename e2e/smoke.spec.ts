// e2e/smoke.spec.ts
// Critical-path smoke tests for the VSIS Timesheet.
// These tests verify the login flow and dashboard load.

import { test, expect } from '@playwright/test'

test.describe('Critical paths', () => {
  test('homepage loads and shows login', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Sign in')).toBeVisible()
  })

  test('dashboard loads for authenticated user', async ({ page }) => {
    await page.goto('/')
    await page.fill('input[type="email"]', process.env.E2E_EMAIL!)
    await page.fill('input[type="password"]', process.env.E2E_PASSWORD!)
    await page.click('button[type="submit"]')
    await expect(page.locator('text=Welcome back')).toBeVisible({ timeout: 15000 })
  })
})

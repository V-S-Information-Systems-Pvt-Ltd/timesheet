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
    // Scoped to the form: the page also renders a "Sign In" tab button.
    await expect(page.locator('form').getByRole('button', { name: 'Sign In' })).toBeVisible()
  })

  test('dashboard loads for authenticated user and logs out', async ({ page }) => {
    test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Set E2E_EMAIL/E2E_PASSWORD to run (needs an activated account).')
    const email = required('E2E_EMAIL')
    const password = required('E2E_PASSWORD')

    await page.goto('/')
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 15000 })
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 15000 })

    // Logout returns to the sign-in screen (covers the logout journey).
    await page.getByRole('button', { name: /logout/i }).click()
    await page.waitForURL('**/', { timeout: 15000 })
    await expect(page.locator('form').getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 15000 })
  })
})

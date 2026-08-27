import { test, expect } from '@playwright/test'

test.describe('Critical paths', () => {
  test('homepage loads and shows login', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible()
  })

  test('dashboard loads for authenticated user and logs out', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()))
    page.on('pageerror', err => console.log('PAGE ERROR:', err))

    const email = process.env.E2E_EMAIL
    const password = process.env.E2E_PASSWORD

    test.skip(!email || !password, 'Missing E2E_EMAIL or E2E_PASSWORD in environment.')

    await page.goto('/')
    await page.fill('input[type="email"]', email!)
    await page.fill('input[type="password"]', password!)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 15000 })
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 15000 })

    // Logout returns to the sign-in screen (covers the logout journey).
    await page.getByRole('button', { name: /logout/i }).click()
    await page.waitForURL('**/', { timeout: 15000 })
    await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible({ timeout: 15000 })
  })
})

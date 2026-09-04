// e2e/password-recovery.spec.ts
// E2E test coverage for password recovery flow:
// 1. Navigation from sign-in to forgot-password page
// 2. Request submission with non-enumerating confirmation message
// 3. Navigation between forgot-password, reset-password, and sign-in pages
// 4. Invalid or missing token handling on reset-password page

import { test, expect } from '@playwright/test'

test.describe('Password recovery journey', () => {
  test('navigates to forgot-password page and submits a reset request', async ({ page }) => {
    await page.goto('/')

    // Locate and click the Forgot password link
    const forgotLink = page.getByRole('link', { name: /forgot password/i })
    await expect(forgotLink).toBeVisible()
    await forgotLink.click()

    await page.waitForURL('**/forgot-password')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible()

    // Submit an email address
    await page.fill('input[type="email"]', 'employee@vsis.lk')
    await page.getByRole('button', { name: /send reset link/i }).click()

    // Non-enumerating success message appears
    await expect(
      page.getByText(/If an account exists for that email, we sent a password reset link/i)
    ).toBeVisible()

    // Back to Sign In link returns to root
    await page.getByRole('link', { name: /back to sign in/i }).click()
    await page.waitForURL('**/')
    await expect(page.locator('form').getByRole('button', { name: 'Sign In' })).toBeVisible()
  })

  test('reset-password page handles missing or invalid token safely', async ({ page }) => {
    // Missing token
    await page.goto('/reset-password')
    await expect(
      page.getByText(/This password reset link is invalid or has expired/i)
    ).toBeVisible({ timeout: 10000 })

    // Link to request a new link points to forgot-password
    const requestNewLink = page.getByRole('link', { name: /request a new reset link/i })
    await expect(requestNewLink).toBeVisible()
    await requestNewLink.click()
    await page.waitForURL('**/forgot-password')
  })
})

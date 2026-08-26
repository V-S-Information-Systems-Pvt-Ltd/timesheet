// e2e/pending-nav.spec.ts
// Runtime coverage for the pending-account navigation flow (NAV-001/002/003):
// an authenticated but inactive account must land on the dashboard approval
// screen, see no Reports entry point, and bounce back from /reports deep links.
//
// Requires a deactivated fixture account; skips cleanly when credentials are
// absent (same convention as the TEST_DATABASE_URL-gated integration tests).

import { test, expect, type Page } from '@playwright/test'

const pendingEmail = process.env.E2E_PENDING_EMAIL
const pendingPassword = process.env.E2E_PENDING_PASSWORD

/**
 * Wait for the dashboard to classify the account as pending. Immediately after
 * login a freshly minted Supabase token can be rejected with transient clock
 * skew ("JWT issued at future"); the dashboard then shows its profile-error
 * view. Exercise that view's Try again recovery until the approval screen
 * appears instead of failing on the transient state.
 */
async function waitForPendingScreen(page: Page) {
  const pending = page.locator('text=Account Pending Approval')
  await expect(async () => {
    if (!(await pending.isVisible())) {
      const tryAgain = page.getByRole('button', { name: 'Try again' })
      if (await tryAgain.isVisible()) await tryAgain.click()
      expect(await pending.isVisible()).toBe(true)
    }
  }).toPass({ timeout: 20000 })
}

test.describe('Pending account navigation', () => {
  test.skip(!pendingEmail || !pendingPassword, 'Set E2E_PENDING_EMAIL/E2E_PENDING_PASSWORD to run (needs a deactivated fixture account).')

  test('pending user sees the approval screen with no Reports nav and /reports redirects back', async ({ page }) => {
    await page.goto('/')
    await page.fill('input[type="email"]', pendingEmail!)
    await page.fill('input[type="password"]', pendingPassword!)
    await page.click('form button[type="submit"]')

    // Dashboard classifies the account as pending.
    await waitForPendingScreen(page)

    // Nav (desktop + drawer) exposes only Dashboard for inactive accounts.
    await expect(page.locator('nav a[href="/reports"]')).toHaveCount(0)

    // Deep link to /reports is redirected back to the dashboard hub.
    await page.goto('/reports')
    await waitForPendingScreen(page)
    expect(new URL(page.url()).pathname).toBe('/dashboard')
  })
})

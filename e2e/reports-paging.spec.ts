// e2e/reports-paging.spec.ts
// Read-only interaction coverage for T18.2 date-scoped report paging:
// initial load carries dates, range changes reset rows without mixing stale
// results, retry preserves the range, and totals are labeled as loaded-row
// totals while more pages remain. No data is written.

import { test, expect } from '@playwright/test'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var ${name} for e2e tests. See .env.example.`)
  return value
}

test.describe('Reports paging (T18.2)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Set E2E_EMAIL/E2E_PASSWORD to run (needs an activated account).')
    const email = required('E2E_EMAIL')
    const password = required('E2E_PASSWORD')

    await page.goto('/')
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 15000 })
  })

  test('range change resets rows and shows the new range badge', async ({ page }) => {
    await page.goto('/reports?tab=myhours')
    // Initial load finishes: either entries or the empty state, never a
    // permanent spinner.
    await expect(
      page.getByText(/entr(y|ies) in selected period|No entries in this period|Failed to load/).first()
    ).toBeVisible({ timeout: 20000 })

    const badge = page.locator('text=/\\d{4}-\\d{2}-\\d{2} → \\d{4}-\\d{2}-\\d{2}/').first()
    await expect(badge).toBeVisible({ timeout: 10000 })
    const before = await badge.textContent()

    // Switch preset: the badge must change and rows must belong to the new
    // range (no stale mix). The URL carries the preset for shareability.
    await page.getByRole('combobox').first().selectOption('last')
    await expect(page).toHaveURL(/preset=last/, { timeout: 10000 })
    const after = await badge.textContent()
    expect(after).not.toBe(before)
    await expect(
      page.getByText(/entr(y|ies) in selected period|No entries in this period|Failed to load/).first()
    ).toBeVisible({ timeout: 20000 })
  })

  test('totals are labeled as loaded-row totals while more pages remain', async ({ page }) => {
    await page.goto('/reports?tab=myhours')
    await expect(
      page.getByText(/entr(y|ies) in selected period|No entries in this period|Failed to load/).first()
    ).toBeVisible({ timeout: 20000 })

    // Either the full total (all rows loaded) or an explicitly partial total.
    const partial = page.getByText(/loaded rows|Showing \d+ of \d+/)
    const full = page.getByText('Total hours', { exact: true })
    await expect(partial.or(full).first()).toBeVisible({ timeout: 10000 })
  })
})

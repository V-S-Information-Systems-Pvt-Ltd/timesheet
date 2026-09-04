// e2e/a11y.spec.ts
// Accessibility checks using axe-core.
// Verifies the login page has no critical or serious violations.

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility', () => {
  test('login page has no critical or serious violations', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(serious).toEqual([])
  })

  test('forgot-password page has no critical or serious violations', async ({ page }) => {
    await page.goto('/forgot-password')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(serious).toEqual([])
  })

  test('reset-password page has no critical or serious violations', async ({ page }) => {
    await page.goto('/reset-password')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(serious).toEqual([])
  })

  test('dashboard and open dialog have no critical or serious violations', async ({ page }) => {
    test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Set E2E_EMAIL/E2E_PASSWORD to run (needs an activated account).')
    const email = process.env.E2E_EMAIL!
    const password = process.env.E2E_PASSWORD!

    await page.goto('/')
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 15000 })
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 15000 })

    const dashboardResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const dashboardSerious = dashboardResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(dashboardSerious).toEqual([])

    // If projects are present, open rename dialog; otherwise create one first
    const renameBtn = page.getByRole('button', { name: 'Rename' }).first()
    if (!await renameBtn.isVisible()) {
      const projectInput = page.getByPlaceholder('e.g. Website Revamp')
      if (await projectInput.isVisible()) {
        await projectInput.fill('A11y Test Project')
        await page.getByRole('button', { name: /Add Project/i }).click()
        await expect(page.getByRole('button', { name: 'Rename' }).first()).toBeVisible({ timeout: 10000 })
      }
    }

    if (await renameBtn.isVisible()) {
      await renameBtn.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const dialogResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const dialogSerious = dialogResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      expect(dialogSerious).toEqual([])
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
    }
  })
})

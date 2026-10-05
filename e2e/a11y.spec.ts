// e2e/a11y.spec.ts
// Accessibility checks using axe-core.
// Verifies the login page has no critical or serious violations.

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

function reportViolations(label: string, violations: Array<{ id: string; impact?: string | null; description: string; helpUrl: string; nodes: unknown[] }>) {
  if (violations.length > 0) {
    console.error(
      `\nAccessibility violations (${label}):\n` +
      violations.map(v => `  - [${v.impact?.toUpperCase()}] ${v.id}: ${v.description} (${v.nodes.length} nodes)\n    Docs: ${v.helpUrl}`).join('\n')
    )
  }
}

test.describe('Accessibility', () => {
  for (const path of ['/', '/forgot-password', '/reset-password']) {
    test(`${path} supports persistent explicit and system themes without serious violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' })
      await page.goto(path)
      await page.getByRole('button', { name: 'Use light theme' }).click()
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('html')).not.toHaveClass(/dark/)
      await expect(page.getByRole('button', { name: 'Use light theme' })).toHaveAttribute('aria-pressed', 'true')
      await page.emulateMedia({ colorScheme: 'light' })
      await page.getByRole('button', { name: 'Use dark theme' }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.reload()
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page.getByRole('button', { name: 'Use dark theme' })).toHaveAttribute('aria-pressed', 'true')
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      reportViolations(`dark ${path}`, serious)
      expect(serious).toEqual([])

      await page.getByRole('button', { name: 'Use system theme' }).click()
      await expect(page.locator('html')).not.toHaveClass(/dark/)
      await expect(page.getByRole('button', { name: 'Use system theme' })).toHaveAttribute('aria-pressed', 'true')
      await page.reload()
      await expect(page.locator('html')).not.toHaveClass(/dark/)
      await expect(page.getByRole('button', { name: 'Use system theme' })).toHaveAttribute('aria-pressed', 'true')
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.emulateMedia({ colorScheme: 'light' })
      await expect(page.locator('html')).not.toHaveClass(/dark/)
    })
  }

  test('login page has no critical or serious violations', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    reportViolations('login page', serious)
    expect(serious).toEqual([])
  })

  test('forgot-password page has no critical or serious violations', async ({ page }) => {
    await page.goto('/forgot-password')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    reportViolations('forgot-password page', serious)
    expect(serious).toEqual([])
  })

  test('reset-password page has no critical or serious violations', async ({ page }) => {
    await page.goto('/reset-password')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    reportViolations('reset-password page', serious)
    expect(serious).toEqual([])
  })

  test('dashboard and open dialog have no critical or serious violations', async ({ page }) => {
    test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Set E2E_EMAIL/E2E_PASSWORD to run (needs an activated account).')
    const email = process.env.E2E_EMAIL!
    const password = process.env.E2E_PASSWORD!

    page.on('requestfailed', (request) => {
      console.error('Request failed:', request.url(), request.failure())
    })

    const loginResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      (response.url().includes('/api/v1/auth/browser/login') || response.url().includes('/api/auth/login') || response.url().includes('/auth/v1/token'))
    )

    await page.goto('/')
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')

    const response = await loginResponse
    if (!response.ok()) {
      throw new Error(`Login failed: ${response.status()} ${await response.text()}`)
    }

    await page.waitForURL('**/dashboard', { timeout: 15000 })
    await expect(page.getByRole('heading', { name: /^welcome back,/i })).toBeVisible({ timeout: 15000 })

    const dashboardResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const dashboardSerious = dashboardResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    reportViolations('dashboard', dashboardSerious)
    expect(dashboardSerious).toEqual([])

    await page.getByRole('button', { name: 'Use dark theme' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    // Audit settled theme colors rather than intermediate transition colors.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation instanceof CSSTransition)
        .map(animation => animation.finished.catch(() => {})))
    })
    const darkResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const darkSerious = darkResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    reportViolations('dark dashboard', darkSerious)
    expect(darkSerious).toEqual([])

    await page.keyboard.press('?')
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    await expect(shortcuts).toBeVisible()
    const shortcutResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const shortcutSerious = shortcutResults.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    reportViolations('dark shortcuts dialog', shortcutSerious)
    expect(shortcutSerious).toEqual([])
    await page.keyboard.press('Escape')
    await expect(shortcuts).not.toBeVisible()

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
      reportViolations('rename dialog', dialogSerious)
      expect(dialogSerious).toEqual([])
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
    }
  })
})

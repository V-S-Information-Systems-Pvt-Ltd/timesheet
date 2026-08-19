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
})

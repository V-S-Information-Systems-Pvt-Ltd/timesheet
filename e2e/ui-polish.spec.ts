// UI-only fixtures: auth and data requests are fulfilled in the browser.
// These checks exercise both backend builds without writing hosted test data.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function signInWithFixtures(page: Page) {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'ui-fixture@example.test',
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
  }
  const profile = {
    ...user, name: 'UI Fixture', department: 'Engineering',
    role: 'admin', permission_role: 'admin', hierarchy_role: 'manager', is_active: true,
  }
  const project = { id: 'ui-project', name: 'UI Project', is_active: true }
  let signedIn = false
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  // This deliberately unsigned token is a browser fixture, not a valid server
  // session. These checks exercise presentation rather than authorization.
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`,
    refresh_token: 'ui-fixture-refresh', token_type: 'bearer', expires_in: 3600, user,
  }

  await page.route(/\/auth\/v1\//, async route => {
    signedIn = true
    await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/user') ? user : session })
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/auth/login') {
      signedIn = true
      await route.fulfill({ json: { error: null } })
      return
    }
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ json: { user: signedIn ? user : null } })
      return
    }
    // Fail closed on unexpected mutations instead of passing them to a server.
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405, json: { error: 'Read-only UI fixture' } })
      return
    }
    if (url.pathname === '/api/v1/timesheets') {
      const start = url.searchParams.get('dateFrom') ?? '2026-09-01'
      const end = url.searchParams.get('dateTo') ?? '2026-09-30'
      const dates = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) ? [start, end] : []
      const rows = dates.map((date, index) => ({
        id: `ui-entry-${index}`, user_id: user.id, project_id: project.id,
        activity_type_id: 'ui-activity', log_date: date, hours_worked: index ? 4 : 6,
        work_done: 'Fixture work', created_at: `${date}T12:00:00Z`,
        project_name: project.name, user_email: user.email, activity_name: 'Development',
      }))
      await route.fulfill({ json: { data: { rows, count: rows.length }, error: null, meta: {} } })
      return
    }
    const data: Record<string, unknown> = {
      '/api/data/profile': profile,
      '/api/data/profiles': [profile],
      '/api/data/projects': [project],
      '/api/data/activity-types': [{ id: 'ui-activity', name: 'Development', is_active: true }],
      '/api/data/backfill-window': { days: 30 },
      '/api/data/reports': {
        totalHours: 10, totalEntries: 2,
        byGroup: [{ label: user.email, hours: 6, entries: 1 }, { label: 'colleague@example.test', hours: 4, entries: 1 }],
      },
    }
    await route.fulfill({ json: { data: data[url.pathname] ?? [], error: null } })
  })
  await page.goto('/')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('Fixture-only-Aa1!')
  await page.locator('form').getByRole('button', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  ), { message: `Layout must fit the ${page.viewportSize()?.width}px viewport` }).toBeLessThanOrEqual(0)
}

test.describe('UI polish with browser fixtures', () => {
  test.beforeEach(async ({ page }) => {
    // Scan settled theme colors rather than intermediate CSS transitions.
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    await signInWithFixtures(page)
  })

  test('mobile tabs remain contained and reachable in both themes', async ({ page }) => {
    await page.goto('/reports?tab=myhours')
    await expect(page.getByRole('figure', { name: 'Daily hours' })).toBeVisible()
    for (const width of [390, 320, 640, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 })
      if (width < 1024) {
        const menu = page.getByRole('button', { name: 'Toggle navigation menu' })
        await menu.click()
        const drawer = page.getByRole('dialog', { name: 'Navigation menu' })
        await expect(drawer).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(drawer).not.toBeVisible()
        await expect(menu).toBeFocused()
      }
      for (const theme of ['light', 'dark']) {
        await page.getByRole('button', { name: `Use ${theme} theme` }).click()
        await expectNoHorizontalOverflow(page)
        const lastTab = page.getByRole('button', { name: 'My Missing', exact: true })
        await lastTab.focus()
        const bounds = await lastTab.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        await lastTab.press('Enter')
        await expect(page).toHaveURL(/tab=missing/)
        await expectNoHorizontalOverflow(page)
        await page.getByRole('button', { name: 'My Hours', exact: true }).click()
        await expect(page).toHaveURL(/tab=myhours/)
      }
      if (width === 320) {
        await page.screenshot({ path: test.info().outputPath('reports-mobile-dark.png'), fullPage: true })
      }
    }
  })

  test('charts, date filters, and shortcuts remain accessible', async ({ page }) => {
    await page.goto('/reports?tab=myhours')
    await page.getByRole('combobox', { name: 'Date range preset' }).selectOption('custom')
    await page.getByLabel('Custom range start date').fill('2026-09-01')
    await page.getByLabel('Custom range end date').fill('2026-09-30')
    await expect(page).toHaveURL(/customEnd=2026-09-30/)
    await page.reload()
    await expect(page.getByLabel('Custom range start date')).toHaveValue('2026-09-01')
    await expect(page.getByLabel('Custom range end date')).toHaveValue('2026-09-30')
    await expect(page.getByRole('figure', { name: 'Daily hours' })).toBeVisible()
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Use ${theme} theme` }).click()
      for (const view of ['myhours', 'summaries', 'compare']) {
        if (view !== 'myhours') {
          await page.getByRole('button', { name: view === 'summaries' ? 'Summaries' : 'Compare', exact: true }).click()
          await page.getByRole('combobox', { name: view === 'summaries' ? 'Summary project' : 'Comparison project' }).selectOption('ui-project')
        }
        await expect(page.getByRole('figure', { name: view === 'myhours' ? 'Daily hours' : view === 'summaries' ? 'Hours per user' : 'Hours by period' })).toBeVisible()
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
        expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({
          id: v.id, nodes: v.nodes.map(node => ({ target: node.target, failure: node.failureSummary })),
        }))).toEqual([])
      }
      await page.getByRole('button', { name: 'My Hours', exact: true }).click()
    }
    const trigger = page.getByRole('button', { name: 'My Hours', exact: true })
    await trigger.focus()
    await page.keyboard.press('?')
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    await expect(shortcuts).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(shortcuts).not.toBeVisible()
    await expect(trigger).toBeFocused()
  })
})

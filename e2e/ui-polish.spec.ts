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
  const project = {
    id: 'ui-project',
    name: 'UI Project with an intentionally very long backend-provided label that must stay inside the mobile viewport',
    is_active: true,
  }
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
      '/api/data/backfill-window': { mode: 'days', windowDays: 30, extraDays: 0 },
      '/api/data/reports': {
        totalHours: 10, totalEntries: 2,
        byGroup: [{ label: user.email, hours: 6, entries: 1 }, { label: 'colleague@example.test', hours: 4, entries: 1 }],
      },
    }
    await route.fulfill({ json: { data: data[url.pathname] ?? [], error: null } })
  })
  await page.route(/\/dashboard(?:\?.*)?$/, async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue({ headers: { ...request.headers(), cookie: '' } })
    const args = JSON.parse(request.postData() ?? '[]') as unknown[]
    const result = args.length === 0
      ? {
          isSuperAdmin: true,
          titles: ['Systems Engineer'],
          domains: [{ id: 'domain-fixture', domain: 'example.test', auto_activate: false }],
          branding: { appName: 'VSIS Timesheet', primaryColor: '#1E73BE', logoUrl: null },
        }
      : { error: 'Read-only UI fixture' }
    await route.fulfill({ contentType: 'text/x-component', body: `0:${JSON.stringify({ a: result, f: [], b: '' })}\n` })
  })
  await page.goto('/')
  await page.waitForFunction(() => {
    const form = document.querySelector('form')
    return form && Object.keys(form).some(key => key.startsWith('__reactProps'))
  })
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

  test('migrated admin and team controls retain labels and accessibility in both themes', async ({ page }) => {
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'User Whitelist', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Permission role for ui-fixture@example.test' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Active: deactivate ui-fixture@example.test', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Timesheet CSV file')).toBeAttached()
    await expect(page.getByLabel('Backup file', { exact: true })).toBeAttached()
    await expect(page.getByRole('heading', { name: 'Email Domain Whitelist', exact: true })).toBeVisible()
    // The dense whitelist table stacks below md: headers hide and each cell
    // carries its column label, so nothing needs horizontal scrolling.
    await page.setViewportSize({ width: 360, height: 800 })
    const table = page.locator('.table-stack table').first()
    expect(await table.evaluate(el => getComputedStyle(el.querySelector('thead')!).display)).toBe('none')
    expect(await table.evaluate(el => getComputedStyle(el).display === 'block')).toBe(true)
    await expect(page.locator('.table-stack td[data-label]').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    expect(await table.evaluate(el => getComputedStyle(el.querySelector('thead')!).display)).toBe('table-header-group')
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Use ${theme} theme` }).click()
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`admin-${theme}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: 'Team', exact: true }).click()
    const directory = page.getByRole('button', { name: 'Directory (1)', exact: true })
    await directory.click()
    await expect(directory).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('table', { name: 'Team directory' })).toContainText('UI Fixture')
    await page.getByRole('textbox', { name: 'Search team members' }).fill('no-match')
    await expect(page.getByText('No matching team members', { exact: true })).toBeVisible()
  })

  test('the labelled CSV selector permits retrying the same invalid file', async ({ page }) => {
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    const input = page.getByLabel('Timesheet CSV file')
    await input.focus()
    const outline = await input.evaluate(element => {
      const style = getComputedStyle(element.closest('label')!)
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    expect(outline.style).toBe('solid')
    expect(outline.width).toBeGreaterThanOrEqual(2)
    const file = { name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('unrecognized\nvalue') }
    await input.setInputFiles(file)
    await expect(page.getByText(/Missing columns:/)).toHaveCount(1)
    await expect(input).toHaveValue('')
    await input.setInputFiles(file)
    await expect(page.getByText(/Missing columns:/)).toHaveCount(2)
    await expect(input).toHaveValue('')
  })

  test('user dashboard pairs secondary panels on wide screens and stays contained on mobile', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    const grid = page.locator('main [class*="lg:grid-cols-2"]').last()
    await expect(grid).toBeVisible()
    expect(await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2)
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 })
      await expectNoHorizontalOverflow(page)
    }
  })

  test('a failed panel load surfaces an error with Retry instead of a silent empty state', async ({ page }) => {
    // Override the activity-types endpoint registered in signInWithFixtures.
    const failPattern = '**/api/data/activity-types*'
    await page.route(failPattern, route =>
      route.fulfill({ status: 500, json: { data: null, error: 'Fixture load failure' } }))
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    await expect(page.getByText('Could not load: Fixture load failure')).toBeVisible()
    const retry = page.getByRole('button', { name: 'Retry', exact: true }).first()
    await expect(retry).toBeVisible()
    // Retrying while the failure persists re-runs the load and keeps the error.
    await retry.click()
    await expect(page.getByText('Could not load: Fixture load failure')).toBeVisible()
    // Once the endpoint recovers, Retry clears the error and shows the data.
    await page.unroute(failPattern)
    await retry.click()
    await expect(page.getByText('Could not load: Fixture load failure')).toHaveCount(0)
    await expect(page.getByRole('cell', { name: 'Development', exact: true })).toBeVisible()
  })

  test('the panel customizer is accessible and announces reorders', async ({ page }) => {
    await page.getByRole('button', { name: 'Customize Panels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Customize Panels', exact: true })).toBeVisible()
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      .map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))
    expect(violations).toEqual([])
    const firstRow = page.locator('li[aria-keyshortcuts]').first()
    await firstRow.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('[aria-live="polite"]').first()).toHaveText(/moved to position/)
  })

  test('CSV import asks for confirmation before importing instead of firing on select', async ({ page }) => {
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    await page.getByLabel('Timesheet CSV file').setInputFiles({
      name: 'valid.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Date,User,Project,Hours,Work Done\n2026-10-01,a@b.com,Proj,8,stuff'),
    })
    // Parsed but not imported: a confirm step shows the row count + Import button.
    await expect(page.getByText(/1 row ready to import/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
  })

  test('the mobile drawer exposes change-password and keyboard shortcuts with visible labels', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Toggle navigation menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation menu' })
    await expect(drawer.getByRole('link', { name: 'Change password', exact: true })).toBeVisible()
    await drawer.getByRole('button', { name: /Keyboard shortcuts/ }).click()
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible()
  })
})

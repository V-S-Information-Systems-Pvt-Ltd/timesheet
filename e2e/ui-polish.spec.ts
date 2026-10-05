// UI-only fixtures: auth and data requests are fulfilled in the browser.
// These checks exercise both backend builds without writing hosted test data.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectFixtureIsolation, installBrowserFixture, rejectFixtureRequest } from './browser-fixture'

test.afterEach(({ page }) => expectFixtureIsolation(page))

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
  await installBrowserFixture(page, user)
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/auth/browser/')) return route.fallback()
    // Fail closed on unexpected mutations instead of passing them to a server.
    if (request.method() !== 'GET') {
      return rejectFixtureRequest(page, route)
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
      '/api/v1/leaves': [],
      '/api/v1/reminders': [],
      '/api/v1/reminders/global': [],
      '/api/v1/admin/superadmin/whitelist': [{ id: 'domain-fixture', domain: 'example.test', auto_activate: false }],
      '/api/v1/admin/branding': { appName: 'VSIS Timesheet', primaryColor: '#1E73BE', logoUrl: null },
      '/api/v1/profile': profile,
      '/api/v1/people': [{ ...user, name: profile.name, department: profile.department, role: profile.role,
        permissionRole: profile.permission_role, hierarchyRole: profile.hierarchy_role, isActive: true }],
      '/api/v1/reference': {
        titles: ['Systems Engineer'],
        projects: [{ ...project, created_at: '2026-01-01T00:00:00Z' }],
        activityTypes: [{ id: 'ui-activity', name: 'Development', is_active: true, created_at: '2026-01-01T00:00:00Z' }],
      },
      '/api/v1/settings/backfill': { mode: 'days', windowDays: 30, extraDays: 0 },
      '/api/v1/layout/web': { dashboard: null, admin: null },
      '/api/v1/capabilities': { isSuperAdmin: true },
      '/api/v1/reports': {
        totalHours: 10, totalEntries: 2,
        byGroup: [{ label: user.email, hours: 6, entries: 1 }, { label: 'colleague@example.test', hours: 4, entries: 1 }],
      },
    }
    if (!(url.pathname in data)) return rejectFixtureRequest(page, route)
    await route.fulfill({ json: { data: data[url.pathname], error: null } })
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
    const failPattern = '**/api/v1/reference*'
    await page.route(failPattern, route =>
      route.fulfill({ status: 500, json: { data: null, error: 'Fixture load failure' } }))
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    await expect(page.getByText('Could not load: Fixture load failure').first()).toBeVisible()
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
    const customizer = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Customize Panels', exact: true }) })
    const firstRow = customizer.locator('li[aria-keyshortcuts]').first()
    await firstRow.focus()
    await page.keyboard.press('ArrowDown')
    await expect(customizer.getByRole('status')).toHaveText(/moved to position/)
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
  test('card dialogs cover the viewport after entrance animations finish', async ({ page }) => {
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    const activity = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Activity Types', exact: true }) })
    await expect(activity.getByRole('button', { name: 'Rename', exact: true })).toBeVisible()
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))
    expect(await activity.evaluate(element => getComputedStyle(element).transform)).toBe('none')
    await activity.getByRole('button', { name: 'Rename', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename Activity Type' })
    await expect(dialog).toBeVisible()
    const backdrop = dialog.locator('..')
    await expect.poll(() => backdrop.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('hierarchy user names and emails remain visible in the mobile stack', async ({ page }) => {
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    const hierarchy = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Organizational Hierarchy' }) })
    const userCell = hierarchy.locator('td[data-label="User"]')
    await expect(userCell).toBeVisible()
    await expect(userCell.getByText('UI Fixture', { exact: true })).toBeVisible()
    await expect(userCell.getByText('ui-fixture@example.test', { exact: true })).toBeVisible()
  })

  test('leave summary Retry and Refresh clear errors and settle failed reads', async ({ page }) => {
    let mode: 'error' | 'network' | 'success' = 'error'
    let release: (() => void) | undefined
    let hold = false
    await page.route('**/api/v1/leaves?*', async route => {
      if (!new URL(route.request().url()).searchParams.has('from')) return route.fallback()
      if (hold) await new Promise<void>(resolve => { release = resolve })
      if (mode === 'network') return route.abort('failed')
      if (mode === 'error') return route.fulfill({ status: 503, json: { data: null, error: { message: 'Summary unavailable' } } })
      return route.fulfill({ json: { data: [1, 2].map(id => ({ id: String(id), user_id: '00000000-0000-4000-8000-000000000001', leave_date: '2026-10-01', reason: '' })), error: null } })
    })
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    const leave = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Leave Management', exact: true }) })
    await expect(leave.getByText('Could not load: Summary unavailable')).toBeVisible()
    mode = 'success'; hold = true
    await leave.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(leave.getByText('Loading summary…')).toBeVisible()
    await expect(leave.getByText('Could not load: Summary unavailable')).toHaveCount(0)
    await expect.poll(() => Boolean(release)).toBe(true)
    hold = false; release!()
    await expect(leave.getByRole('table', { name: 'Monthly leave summary' })).toContainText('2 days')
    mode = 'network'
    await leave.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(leave.getByText(/Could not load:/)).toBeVisible()
    await expect(leave.getByText('Loading summary…')).toHaveCount(0)
    mode = 'success'
    await leave.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(leave.getByRole('table', { name: 'Monthly leave summary' })).toContainText('2 days')
    await expect(leave.getByText(/Could not load:/)).toHaveCount(0)
  })

  test('stale leave reads and mutation completions refresh only the selected month', async ({ page }) => {
    let releaseJanuary: (() => void) | undefined
    let releaseMutation: (() => void) | undefined
    const months: string[] = []
    await page.route('**/api/v1/leaves*', async route => {
      const request = route.request()
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as { rows: { leaveDate: string }[] }
        expect(body.rows).toHaveLength(1)
        expect(body.rows[0].leaveDate).toBe('2026-02-10')
        await new Promise<void>(resolve => { releaseMutation = resolve })
        return route.fulfill({ json: { data: null, error: null } })
      }
      if (request.method() !== 'GET') return rejectFixtureRequest(page, route)
      const from = new URL(request.url()).searchParams.get('from')
      if (!from) return route.fallback()
      months.push(from)
      if (from === '2026-01-01') {
        await new Promise<void>(resolve => { releaseJanuary = resolve })
        return route.fulfill({ status: 503, json: { data: null, error: { message: 'Stale January error' } } })
      }
      return route.fulfill({ json: { data: Array.from({ length: from === '2026-03-01' ? 3 : 1 }, (_, id) => ({ id: String(id), user_id: '00000000-0000-4000-8000-000000000001', leave_date: from, reason: '' })), error: null } })
    })
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    const leave = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Leave Management', exact: true }) })
    const month = leave.getByLabel('Leave summary month')
    await month.fill('2026-01')
    await expect.poll(() => Boolean(releaseJanuary)).toBe(true)
    await month.fill('2026-02')
    await expect(leave.getByRole('table', { name: 'Monthly leave summary' })).toContainText('1 day')
    releaseJanuary!()
    await expect(leave.getByText(/Stale January error/)).toHaveCount(0)
    await leave.getByLabel('User', { exact: true }).selectOption('00000000-0000-4000-8000-000000000001')
    await leave.getByLabel('From', { exact: true }).fill('2026-02-10')
    await leave.getByLabel('To', { exact: true }).fill('2026-02-10')
    await leave.getByRole('button', { name: 'Set Leave', exact: true }).click()
    await expect.poll(() => Boolean(releaseMutation)).toBe(true)
    await month.fill('2026-03')
    await expect(leave.getByRole('table', { name: 'Monthly leave summary' })).toContainText('3 days')
    const beforeMutation = months.length
    releaseMutation!()
    await expect.poll(() => months.length).toBeGreaterThan(beforeMutation)
    expect(months.slice(beforeMutation)).toEqual(['2026-03-01'])
    await expect(leave.getByRole('table', { name: 'Monthly leave summary' })).toContainText('3 days')
    await expect(leave.getByText(/Could not load:/)).toHaveCount(0)
  })

  test('CSV replacement clears old previews and ignores cancelled, stale, and failed file reads', async ({ page }) => {
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    await page.evaluate(() => {
      const original = File.prototype.text
      const state = window as Window & { csvReads?: Record<string, { resolve: () => void; reject: () => void }> }
      state.csvReads = {}
      File.prototype.text = function () {
        if (!this.name.startsWith('held-')) return original.call(this)
        return new Promise<string>((resolve, reject) => {
          state.csvReads![this.name] = {
            resolve: () => { void original.call(this).then(resolve, reject) },
            reject: () => reject(new Error('Fixture file read failed')),
          }
        })
      }
    })
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Import Timesheets', exact: true }) })
    const input = panel.getByLabel('Timesheet CSV file')
    const csv = (name: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('Date,User,Project,Hours,Work Done\n2026-10-01,a@b.com,Proj,8,stuff') })
    const complete = (name: string, failed = false) => page.evaluate(({ name, failed }) => {
      const state = window as Window & { csvReads?: Record<string, { resolve: () => void; reject: () => void }> }
      if (failed) state.csvReads![name].reject()
      else state.csvReads![name].resolve()
    }, { name, failed })
    await input.setInputFiles(csv('valid.csv'))
    await expect(panel.getByText(/1 row ready to import/)).toBeVisible()
    await input.setInputFiles(csv('held-old.csv'))
    await expect(panel.getByText('Reading CSV…')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
    await input.setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('unrecognized\nvalue') })
    await expect(page.getByText(/Missing columns:/)).toBeVisible()
    await complete('held-old.csv')
    await expect(panel.getByText(/ready to import/)).toHaveCount(0)
    await input.setInputFiles(csv('held-cancel.csv'))
    await expect(panel.getByText('Reading CSV…')).toBeVisible()
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
    await complete('held-cancel.csv')
    await expect(panel.getByText(/ready to import|Reading CSV/)).toHaveCount(0)
    await input.setInputFiles(csv('held-fail.csv'))
    await expect(panel.getByText('Reading CSV…')).toBeVisible()
    await complete('held-fail.csv', true)
    await expect(page.getByText('Could not read CSV file.')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
    await input.setInputFiles(csv('held-new.csv'))
    await expect(panel.getByText('Reading CSV…')).toBeVisible()
    await complete('held-new.csv')
    await expect(panel.getByText(/1 row ready to import/)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
  })

  test('CSV confirmation retries the same payload and preserves a persistent import summary', async ({ page }) => {
    const requests: unknown[] = []
    await page.route('**/api/v1/admin/timesheets/import', async route => {
      if (route.request().method() !== 'POST') return rejectFixtureRequest(page, route)
      requests.push(route.request().postDataJSON())
      if (requests.length === 1) return route.fulfill({ status: 503, json: { data: null, error: { message: 'Import unavailable' } } })
      return route.fulfill({ json: { data: { imported: 1, skipped: 0, errors: [] }, error: null } })
    })
    await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Import Timesheets', exact: true }) })
    await panel.getByLabel('Timesheet CSV file').setInputFiles({ name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,User,Project,Hours,Work Done\n2026-10-01,a@b.com,Proj,8,stuff') })
    await expect(panel.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText('Import unavailable')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(panel.getByText('Imported 1 entry.')).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    await expect(panel.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
  })

})

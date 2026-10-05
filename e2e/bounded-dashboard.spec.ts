// Native production browser fixture. All browser API calls (including writes)
// are fulfilled locally; these tests never forward mutations to a database.
import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const alice = '00000000-0000-4000-8000-000000000001'
const bob = '00000000-0000-4000-8000-000000000002'
const table = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent Entries', exact: true }) })
const telegram = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Telegram Bot Commands', exact: true }) })

async function fixture(page: Page, entryForm = false) {
  const user = { id: alice, email: 'bounded-fixture@example.test' }
  const dashboardLayout = { tiles: ['entry-form', 'entries', 'telegram', 'leave', 'reminders', 'global-reminders', 'profile'].map(id => ({ id, enabled: id === 'entries' || id === 'telegram' || (entryForm && id === 'entry-form') })) }
  const adminLayout = { tiles: ['settings', 'user-whitelist', 'hierarchy', 'add-user', 'backfill', 'activity-types', 'global-reminders', 'leave-admin', 'project-manager', 'report-export', 'import', 'backup', 'super-admin'].map(id => ({ id, enabled: id === 'report-export' || id === 'user-whitelist' })) }
  const profile = { ...user, name: 'Alice', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', is_active: true, dashboard_layout: dashboardLayout, admin_layout: adminLayout }
  const people = [
    { ...user, name: 'Alice', role: 'admin', permissionRole: 'admin', hierarchyRole: 'user', isActive: true },
    { id: bob, email: 'bob@example.test', name: 'Bob', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true },
  ]
  let rows = Array.from({ length: 1105 }, (_, index) => ({
    id: `entry-${index}`, user_id: index < 102 ? alice : bob,
    project_id: 'project-1', activity_type_id: 'activity-1',
    log_date: index === 0 ? '2099-01-01' : '2020-01-01',
    created_at: new Date(Date.UTC(2020, 0, 1, 0, 0, 1105 - index)).toISOString(),
    hours_worked: 1, work_done: `Work ${index}`, project_name: 'Fixture Project', activity_name: 'Development', user_email: index < 102 ? user.email : 'bob@example.test',
  }))
  let signedIn = false
  let failSecond = false
  let holdSecond = false
  let release: (() => void) | undefined
  let holdBatch = false
  let batchResult: 'success' | 'error' | 'partial' | 'transport' = 'success'
  let releaseBatch: (() => void) | undefined
  let rejectWrite = false
  const requests: URLSearchParams[] = []
  const writes: { path: string; body: unknown }[] = []
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const success = (data: unknown) => route.fulfill({ json: { data, error: null } })
    if (path === '/api/v1/auth/browser/me') return route.fulfill({ json: { user: signedIn ? user : null } })
    if (path === '/api/v1/auth/browser/login') { signedIn = true; return route.fulfill({ json: { error: null } }) }
    if (path === '/api/v1/auth/browser/logout') { signedIn = false; return route.fulfill({ json: { error: null } }) }
    if (request.method() !== 'GET') {
      const body = request.postDataJSON()
      writes.push({ path, body })
      if (rejectWrite) { rejectWrite = false; return route.fulfill({ status: 503, json: { data: null, error: { message: 'CRUD fixture rejected' } } }) }
      if (request.method() === 'POST' && path === '/api/v1/timesheets') {
        rows = [{ ...rows[0], id: 'entry-created', user_id: alice, log_date: body.logDate,
          work_done: body.workDone, hours_worked: body.hoursWorked, created_at: new Date().toISOString() }, ...rows]
        return success({ success: true })
      }
      if (request.method() === 'POST' && path.endsWith('/duplicate')) {
        const source = rows.find(row => row.id === path.split('/').at(-2))!
        const entry = { ...source, id: 'entry-duplicate', log_date: body.targetDate || source.log_date }
        rows = [entry, ...rows]
        return success({ success: true, entry })
      }
      if (request.method() === 'DELETE' && /^\/api\/v1\/timesheets\/entry-[^/]+$/.test(path)) {
        rows = rows.filter(row => row.id !== path.split('/').at(-1))
        return success({ success: true })
      }
      if (request.method() === 'PUT' && /^\/api\/v1\/timesheets\/entry-[^/]+$/.test(path)) {
        const id = path.split('/').at(-1)
        rows = rows.map(row => row.id === id ? { ...row, work_done: body.workDone, hours_worked: body.hoursWorked } : row)
        return success({ success: true })
      }
      if (path === '/api/v1/timesheets/batch-update') {
        if (holdBatch) await new Promise<void>(resolve => { releaseBatch = resolve })
        if (batchResult === 'transport') return route.abort('failed')
        if (batchResult === 'error') return route.fulfill({ status: 503, json: { data: null, error: { message: 'Batch rejected' } } })
        if (batchResult === 'partial') return success({ updated: 1, errors: ['Second row rejected'] })
        return success({ updated: body.entries.length })
      }
      return route.fulfill({ status: 405, json: { data: null, error: { message: 'Fixture blocks unexpected writes' } } })
    }
    if (path === '/api/v1/timesheets') {
      const query = url.searchParams
      requests.push(new URLSearchParams(query))
      const from = Number(query.get('from') ?? 0)
      const size = query.has('to') ? Number(query.get('to')) - from + 1 : Number(query.get('limit') ?? 50)
      if (from >= 1000) {
        if (holdSecond) await new Promise<void>(resolve => { release = resolve })
        if (failSecond) return route.fulfill({ status: 503, json: { data: null, error: { message: 'History page failed' } } })
      }
      const filtered = rows.filter(row => (!query.get('userId') || row.user_id === query.get('userId')) && (!query.get('dateFrom') || row.log_date >= query.get('dateFrom')!) && (!query.get('dateTo') || row.log_date <= query.get('dateTo')!))
      return success({ rows: filtered.slice(from, from + Math.min(size, 1000)), count: query.get('includeCount') === 'false' ? 0 : filtered.length })
    }
    if (path === '/api/v1/timesheets/last') return success({ entry: rows.find(row => row.user_id === alice) ?? null })
    if (path === '/api/v1/profile') return success(profile)
    if (path === '/api/v1/people') return success(people)
    if (path === '/api/v1/reference') return success({
      projects: [{ id: 'project-1', name: entryForm ? 'Internal' : 'Fixture Project', telegram_no: 17, created_at: '2020-01-01' }],
      activityTypes: [{ id: 'activity-1', name: 'Development', is_active: true, telegram_no: 17, created_at: '2020-01-01' }],
    })
    if (path === '/api/v1/settings/backfill') return success({ mode: 'days', windowDays: 30, extraDays: 0 })
    if (path === '/api/v1/layout/web') return success({ dashboard: dashboardLayout, admin: adminLayout })
    if (path === '/api/v1/capabilities') return success({ isSuperAdmin: false })
    if (path === '/api/v1/reports') return success({ totalHours: rows.length, totalEntries: rows.length, byGroup: [] })
    return success([])
  })
  await page.goto('/')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('Fixture-only-Aa1!')
  await page.locator('form').getByRole('button', { name: 'Sign In' }).click()
  await expect(table(page).locator('[data-row-id]')).toHaveCount(50)
  return {
    requests, writes, rejectNextWrite: () => { rejectWrite = true },
    failSecond: () => { failSecond = true },
    holdSecond: () => { holdSecond = true },
    isHeld: () => Boolean(release),
    release: () => { holdSecond = false; release?.() },
    holdBatch: (result: typeof batchResult) => { holdBatch = true; batchResult = result },
    batchHeld: () => Boolean(releaseBatch),
    releaseBatch: () => { holdBatch = false; releaseBatch?.() },
  }
}

test('one initial server page, URL paging/filter state and independently browsable older Telegram entries', async ({ page }) => {
  const data = await fixture(page)
  expect(data.requests.filter(query => query.has('from') && query.get('to') === '49')).toHaveLength(1)
  await table(page).getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(table(page).locator('[data-row-id="entry-50"]')).toBeVisible()
  await table(page).getByLabel('Filter by user').selectOption(bob)
  await expect(page).toHaveURL(new RegExp(`user=${bob}`))
  await expect(table(page).locator('[data-row-id="entry-102"]')).toBeVisible()
  await table(page).getByLabel('Entries per page').selectOption('25')
  await expect(page).toHaveURL(/size=25/)
  await expect(table(page).locator('[data-row-id]')).toHaveCount(25)
  await expect(telegram(page).locator('li')).toHaveCount(25)
  const first = await telegram(page).locator('code').first().textContent()
  await telegram(page).getByRole('button', { name: 'Next', exact: true }).click()
  await expect(telegram(page)).toContainText('Page 2 of 45')
  await expect(telegram(page).locator('code').first()).not.toHaveText(first!)
  expect(data.requests.some(query => query.get('from') === '25' && query.get('to') === '49' && !query.has('userId'))).toBe(true)
})

test('checkbox selects page; full history is explicit; an individual edit clears stale snapshots before the next bulk payload', async ({ page }) => {
  const data = await fixture(page)
  await table(page).getByRole('checkbox', { name: 'Select entries on this page' }).check()
  await expect(table(page)).toContainText('50 selected')
  await table(page).locator('[data-row-id="entry-0"]').getByRole('button', { name: 'Edit', exact: true }).click()
  await table(page).getByLabel('Work Done', { exact: true }).fill('Confirmed new description')
  await table(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(table(page).locator('[data-row-id="entry-0"]')).toContainText('Confirmed new description')
  await expect(table(page).getByRole('button', { name: 'Bulk Edit', exact: true })).toBeDisabled()
  await table(page).getByLabel('Filter by user').selectOption(alice)
  await expect(table(page)).toContainText('102 entries')
  await table(page).getByRole('button', { name: 'Select all filtered history', exact: true }).click()
  await expect(table(page)).toContainText('102 selected')
  await table(page).getByRole('button', { name: 'Bulk Edit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Bulk Edit', exact: true })
  await dialog.getByLabel('Activity Type', { exact: true }).selectOption('activity-1')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => data.writes.filter(write => write.path.endsWith('/batch-update')).length).toBe(1)
  const payload = data.writes.find(write => write.path.endsWith('/batch-update'))!.body as { entries: { id: string; workDone: string }[] }
  expect(payload.entries).toHaveLength(102)
  expect(payload.entries.find(row => row.id === 'entry-0')?.workDone).toBe('Confirmed new description')
  expect(payload.entries.some(row => row.id === 'entry-101')).toBe(true)
})

test('complete CSV includes more than one history page, old entries and future entries', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  const result = await download
  const csv = await readFile((await result.path())!, 'utf8')
  expect(csv.trim().split(/\r?\n/)).toHaveLength(1106)
  expect(csv).toContain('2099-01-01')
  expect(csv).toContain('2020-01-01')
  expect(csv).toContain('Work 1104')
})

test('local calendar entry creation, edit, duplicate and failed/successful delete reconcile bounded rows', async ({ page }) => {
  const data = await fixture(page, true)
  const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Log Time', exact: true }) })
  await form.getByRole('radio', { name: 'Development', exact: true }).check()
  await form.getByLabel('Hours', { exact: true }).fill('2')
  await form.getByLabel('Work Done', { exact: true }).fill('New confirmed entry')
  await form.getByRole('button', { name: 'Submit Entry', exact: true }).click()
  const created = table(page).locator('[data-row-id="entry-created"]')
  await expect(created).toContainText('New confirmed entry')
  await created.getByRole('button', { name: 'Edit', exact: true }).click()
  await table(page).getByLabel('Work Done', { exact: true }).fill('Edited confirmed entry')
  await table(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(created).toContainText('Edited confirmed entry')
  await created.getByRole('button', { name: 'Duplicate', exact: true }).click()
  const duplicate = table(page).locator('[data-row-id="entry-duplicate"]')
  await expect(duplicate).toContainText('Edited confirmed entry')
  data.rejectNextWrite()
  await duplicate.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('CRUD fixture rejected', { exact: true })).toBeVisible()
  await expect(duplicate).toContainText('Edited confirmed entry')
  await duplicate.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(duplicate).toHaveCount(0)
  await expect(created).toContainText('Edited confirmed entry')
  expect(data.writes.map(write => write.path)).toEqual([
    '/api/v1/timesheets', '/api/v1/timesheets/entry-created',
    '/api/v1/timesheets/entry-created/duplicate', '/api/v1/timesheets/entry-duplicate',
    '/api/v1/timesheets/entry-duplicate',
  ])
})

test('failed middle history page never downloads a CSV, installs a partial selection, or deactivates a user', async ({ page }) => {
  const data = await fixture(page)
  data.failSecond()
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await table(page).getByRole('button', { name: 'Select all filtered history', exact: true }).click()
  await expect(table(page)).toContainText('History page failed')
  await expect(table(page).getByRole('button', { name: 'Bulk Edit', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  await expect(page.getByText('History page failed', { exact: true })).toBeVisible()
  const bobRow = page.locator('tr').filter({ hasText: 'bob@example.test' })
  await bobRow.getByRole('button', { name: 'Active', exact: true }).click()
  await page.getByRole('button', { name: 'Export entries to CSV, then deactivate', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export entries to CSV, then deactivate', exact: true })).toBeEnabled()
  expect(downloads).toEqual([])
  expect(data.writes).toEqual([])
})

test('unmount cancels an in-flight full export before a download', async ({ page }) => {
  const data = await fixture(page)
  data.holdSecond()
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  await expect.poll(data.isHeld).toBe(true)
  await page.getByRole('button', { name: 'My Timesheet', exact: true }).click()
  await expect(table(page)).toBeVisible()
  data.release()
  // A subsequent completed same-URL read establishes that the held request has
  // settled; no old panel callback may download its response.
  await table(page).getByRole('button', { name: 'Select all filtered history', exact: true }).click()
  await expect(table(page)).toContainText('1105 selected')
  expect(downloads).toEqual([])
})

for (const outcome of ['success', 'error', 'partial', 'transport'] as const) {
  test(`delayed bulk ${outcome} holds page/row locks, blocks dismissal and discards selection after reconciliation`, async ({ page }) => {
    const data = await fixture(page)
    data.holdBatch(outcome)
    await table(page).getByRole('checkbox', { name: 'Select entries on this page' }).check()
    await table(page).getByRole('button', { name: 'Bulk Edit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Bulk Edit', exact: true })
    await dialog.getByLabel('Activity Type', { exact: true }).selectOption('activity-1')
    const beforeReads = data.requests.length
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(data.batchHeld).toBe(true)
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).first()).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).last()).toBeDisabled()
    await expect(table(page).getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    await expect(table(page).getByLabel('Filter by user')).toBeDisabled()
    await expect(table(page).getByLabel('Entries per page')).toBeDisabled()
    await expect(table(page).locator('[data-row-id="entry-0"]').getByRole('button', { name: 'Edit', exact: true })).toBeDisabled()
    await expect(table(page).locator('[data-row-id="entry-49"]').getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled()
    await expect(table(page).getByRole('button', { name: 'Undo Last', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    // A backdrop click takes the same guarded dismissal path as Escape.
    await dialog.locator('..').click({ position: { x: 3, y: 3 } })
    await expect(dialog).toBeVisible()
    expect(data.writes.filter(write => write.path.endsWith('/batch-update'))).toHaveLength(1)
    data.releaseBatch()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => data.requests.length).toBeGreaterThan(beforeReads)
    await expect(table(page).getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
    await expect(table(page).getByLabel('Filter by user')).toBeEnabled()
    await expect(table(page).locator('[data-row-id="entry-0"]').getByRole('button', { name: 'Edit', exact: true })).toBeEnabled()
    await expect(table(page).getByRole('button', { name: 'Bulk Edit', exact: true })).toBeDisabled()
    await expect(table(page).getByRole('checkbox', { name: 'Select entries on this page' })).not.toBeChecked()
    if (outcome === 'error') await expect(page.getByText('Batch rejected', { exact: true })).toBeVisible()
    if (outcome === 'partial') await expect(page.getByText('Updated 1 of 50 entries. Select entries again before retrying.', { exact: true })).toBeVisible()
  })
}

// Browser-only transport fixtures: no hosted rows or credentials are mutated.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expectFixtureIsolation, installBrowserFixture, rejectFixtureRequest } from './browser-fixture'

test.afterEach(({ page }) => expectFixtureIsolation(page))

type Operation = 'duplicate' | 'edit' | 'delete'

async function dashboardFixture(page: Page, operation: Operation, failures: string[] = [], options: { regular?: boolean; oldSource?: boolean } = {}) {
  const user = {
    id: '00000000-0000-4000-8000-000000000001', email: 'mutation-fixture@example.test',
    aud: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {},
  }
  const role = options.regular ? 'user' : 'admin'
  const profile = { ...user, name: 'Mutation Fixture', role, permission_role: role, hierarchy_role: 'user', is_active: true }
  const date = '2026-10-02'
  let rows = ['entry-1', 'entry-2'].map(id => ({
    id, user_id: user.id, project_id: 'project-1', activity_type_id: 'activity-1',
    log_date: options.oldSource && id === 'entry-1' ? '2025-01-01' : id === 'entry-2' ? '2026-10-01' : date,
    hours_worked: 2, work_done: `Work ${id}`, created_at: `${date}T08:00:00Z`,
    project_name: 'Fixture Project', user_email: user.email, activity_name: 'Development',
  }))
  let failRefresh = false
  let hold = false
  const heldWrites = new Set<string>()
  const releaseActions = new Map<string, () => void>()
  let holdRead = false
  let releaseRead: (() => void) | undefined
  const calls: unknown[][] = []
  await installBrowserFixture(page, user)
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const success = (data: unknown) => route.fulfill({ json: { data, error: null } })
    if (path.startsWith('/api/v1/auth/browser/')) return route.fallback()
    if (request.method() !== 'GET') {
      const match = /^\/api\/v1\/timesheets\/(entry-[^/]+)(\/duplicate)?$/.exec(path)
      const method = request.method()
      if (!match || !(match[2] ? method === 'POST' : method === 'PUT' || method === 'DELETE')) return rejectFixtureRequest(page, route)
      const id = match[1]
      const input = method === 'DELETE' ? undefined : request.postDataJSON()
      const args = match[2] ? (input.targetDate ? [id, input.targetDate] : [id]) : method === 'PUT' ? [id, input] : [id]
      calls.push(args)
      const callNumber = calls.length
      if (hold || heldWrites.has(id)) await new Promise<void>(resolve => { releaseActions.set(id, resolve) })
      const source = rows.find(r => r.id === id)!
      if (failures.includes(`transport:${id}`)) return route.abort('failed')
      if (failures.includes(id)) return route.fulfill({ status: 503, json: { data: null, error: { code: 'INTERNAL_ERROR', message: 'Fixture write rejected' } } })
      if (match[2]) {
        expect(operation).toBe('duplicate')
        const entry = { ...source, id: `entry-copy-${callNumber}`, log_date: input.targetDate || source.log_date }
        rows = [entry, ...rows]
        return success({ success: true, entry })
      }
      if (method === 'DELETE') {
        expect(operation).toBe('delete')
        rows = rows.filter(r => r.id !== id)
      } else {
        expect(operation).toBe('edit')
        rows = rows.map(r => r.id === id ? { ...r, work_done: input.workDone, hours_worked: input.hoursWorked,
          project_id: input.projectId, activity_type_id: input.activityTypeId, log_date: input.logDate } : r)
      }
      return success({ success: true })
    }
    if (path === '/api/v1/timesheets') {
      const query = url.searchParams
      const entriesPage = query.get('from') === '0' && query.get('to') === '49' && query.get('includeCount') !== 'false'
      const filtered = rows.filter(r => (!query.get('userId') || r.user_id === query.get('userId')) &&
        (!query.get('dateFrom') || r.log_date >= query.get('dateFrom')!) && (!query.get('dateTo') || r.log_date <= query.get('dateTo')!))
      const from = Number(query.get('from') ?? 0)
      const size = query.has('to') ? Number(query.get('to')) - from + 1 : Number(query.get('limit') ?? 50)
      const snapshot = filtered.slice(from, from + size)
      if (entriesPage && failRefresh) return route.fulfill({ status: 503, json: { data: null, error: { code: 'INTERNAL_ERROR', message: 'Fixture refresh failure' } } })
      if (entriesPage && holdRead) {
        holdRead = false
        await new Promise<void>(resolve => { releaseRead = resolve })
      }
      return success({ rows: snapshot, count: query.get('includeCount') === 'false' ? 0 : filtered.length })
    }
    if (path === '/api/v1/timesheets/last') return success({ entry: rows[0] ?? null })
    const data: Record<string, unknown> = {
      '/api/v1/profile': profile,
      '/api/v1/people': [{ ...user, name: profile.name, role, permissionRole: role, hierarchyRole: 'user', isActive: true }],
      '/api/v1/reference': {
        projects: [{ id: 'project-1', name: 'Fixture Project', created_at: `${date}T00:00:00Z` }],
        activityTypes: [{ id: 'activity-1', name: 'Development', is_active: true, created_at: `${date}T00:00:00Z` }],
      },
      '/api/v1/settings/backfill': { mode: 'days', windowDays: 30, extraDays: 0 },
      '/api/v1/layout/web': { dashboard: null, admin: null },
      '/api/v1/capabilities': { isSuperAdmin: false },
      '/api/v1/reports': { totalHours: rows.length * 2, totalEntries: rows.length, byGroup: [] },
    }
    return success(data[path] ?? [])
  })
  await page.goto('/')
  // Dev compilation can render the form before its client handlers hydrate.
  await page.waitForFunction(() => {
    const form = document.querySelector('form')
    return form && Object.keys(form).some(key => key.startsWith('__reactProps'))
  })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('Fixture-only-Aa1!')
  await page.locator('form').getByRole('button', { name: 'Sign In' }).click()
  await expect(page.locator('[data-row-id="entry-1"]')).toBeVisible()
  return {
    calls,
    hold: (id?: string) => { if (id) heldWrites.add(id); else hold = true },
    release: (id?: string) => {
      if (id) { heldWrites.delete(id); releaseActions.get(id)?.(); releaseActions.delete(id) }
      else { hold = false; heldWrites.clear(); releaseActions.forEach(release => release()); releaseActions.clear() }
    },
    failRefresh: () => { failRefresh = true },
    recoverRefresh: () => { failRefresh = false },
    holdRefresh: () => { holdRead = true },
    refreshHeld: () => releaseRead !== undefined,
    releaseRefresh: () => { releaseRead?.() },
    snapshot: () => rows,
  }
}

const row = (page: Page, id = 'entry-1') => page.locator(`[data-row-id="${id}"]`)
const temps = (page: Page) => page.locator('[data-row-id^="temp-"]')
const entries = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent Entries', exact: true }) })

test('duplicate appears immediately, blocks double-fire, and reconciles real IDs', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate')
  fixture.hold()
  const duplicate = row(page).getByRole('button', { name: 'Duplicate', exact: true })
  await duplicate.click()
  await expect(temps(page)).toHaveCount(1)
  await expect(temps(page).getByRole('checkbox')).toBeDisabled()
  await expect(temps(page)).toContainText('Saving…')
  await expect(duplicate).toBeDisabled()
  await page.keyboard.press('d')
  expect(fixture.calls).toHaveLength(1)
  fixture.release()
  await expect(temps(page)).toHaveCount(0)
  await expect(row(page, 'entry-copy-1')).toBeVisible()
})

test('overlapping duplicates do not reuse a stale in-flight refresh', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate')
  fixture.hold()
  fixture.holdRefresh()
  await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
  await row(page, 'entry-2').getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect.poll(() => fixture.calls.length).toBe(2)
  // Start both writes while the snapshot is usable; complete the second during
  // the first held reconciliation, when fresh UI writes are intentionally blocked.
  fixture.release('entry-1')
  await expect.poll(fixture.refreshHeld).toBe(true)
  fixture.release('entry-2')
  await expect.poll(() => fixture.snapshot().length).toBe(4)
  fixture.releaseRefresh()
  await expect(temps(page)).toHaveCount(0)
  await expect(row(page, 'entry-copy-1')).toBeVisible()
  await expect(row(page, 'entry-copy-2')).toBeVisible()
})

for (const rejection of ['edit', 'delete'] as const) {
  test(`rejected ${rejection} does not cancel another duplicate's refresh`, async ({ page }) => {
    const fixture = await dashboardFixture(page, 'duplicate', ['entry-2'])
    fixture.hold()
    fixture.holdRefresh()
    await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
    await row(page, 'entry-2').getByRole('button', { name: rejection === 'edit' ? 'Edit' : 'Delete', exact: true }).click()
    if (rejection === 'edit') {
      await page.getByRole('textbox', { name: 'Work Done', exact: true }).fill('Rejected draft')
      await page.getByRole('table').getByRole('button', { name: 'Save', exact: true }).click()
    } else await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => fixture.calls.length).toBe(2)
    fixture.release('entry-1')
    await expect.poll(fixture.refreshHeld).toBe(true)
    fixture.release('entry-2')
    await expect(page.getByText('Fixture write rejected', { exact: true })).toBeVisible()
    fixture.releaseRefresh()
    await expect(row(page, 'entry-copy-1')).toBeVisible()
    await expect(temps(page)).toHaveCount(0)
  })
}

test('duplicate locks survive leaving and remounting the entries tab', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate')
  fixture.hold()
  await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect.poll(() => fixture.calls.length).toBe(1)
  await page.getByRole('button', { name: 'Team', exact: true }).click()
  await expect(row(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'My Timesheet', exact: true }).click()
  await expect(row(page)).toBeVisible()
  await expect(row(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled()
  fixture.release()
  await expect(row(page, 'entry-copy-1')).toBeVisible()
  await expect(row(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled()
  expect(fixture.calls).toHaveLength(1)
})

test('single and bulk duplicates work when randomUUID is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined }) })
  const fixture = await dashboardFixture(page, 'duplicate')
  await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(row(page, 'entry-copy-1')).toBeVisible()
  await row(page, 'entry-2').getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).first().click()
  await expect(row(page, 'entry-copy-2')).toBeVisible()
  await expect(temps(page)).toHaveCount(0)
  expect(fixture.calls).toHaveLength(2)
})

test('failed delete preserves server ordering even without a refresh', async ({ page }) => {
  await dashboardFixture(page, 'delete', ['entry-2'])
  await row(page, 'entry-2').getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Fixture write rejected', { exact: true })).toBeVisible()
  expect(await page.locator('[data-row-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-row-id')))).toEqual(['entry-1', 'entry-2'])
  await page.getByRole('button', { name: 'Edit Last', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Work Done', exact: true })).toHaveValue('Work entry-1')
})

test('regular users can copy an older owned row to a writable target date', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate', [], { regular: true, oldSource: true })
  await expect(row(page).getByRole('button', { name: 'Edit', exact: true })).toBeDisabled()
  await expect(row(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled()
  await row(page).getByRole('button', { name: 'Duplicate to date', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Duplicate to date', exact: true })
  await dialog.getByLabel('Target date').fill('2026-10-02')
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(row(page, 'entry-copy-1')).toContainText('2026-10-02')
  expect(fixture.calls[0]).toEqual(['entry-1', '2026-10-02'])
})

test('successful duplicate drops temporary IDs even when refresh fails', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate')
  fixture.failRefresh()
  await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByText('Entry duplicated.', { exact: true })).toBeVisible()
  await expect(temps(page)).toHaveCount(0)
  await expect(entries(page).getByRole('alert')).toContainText('Fixture refresh failure')
  await expect(row(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled()
  await page.keyboard.press('d')
  expect(fixture.calls).toHaveLength(1)
  fixture.recoverRefresh()
  await page.getByRole('button', { name: 'Retry entries', exact: true }).click()
  await expect(row(page, 'entry-copy-1')).toBeVisible()
  await expect(row(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled()
})

test('successful edit reconciles the authoritative list', async ({ page }) => {
  await dashboardFixture(page, 'edit')
  await row(page).getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('textbox', { name: 'Work Done', exact: true }).fill('Saved edit')
  await page.getByRole('table').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Entry updated successfully!', { exact: true })).toBeVisible()
  await expect(row(page)).toContainText('Saved edit')
})

test('single delete disappears immediately and returns after rejection', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'delete', ['entry-1'])
  fixture.hold()
  await row(page).getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(row(page)).toHaveCount(0)
  fixture.release()
  await expect(row(page)).toBeVisible()
  await expect(page.getByText('Fixture write rejected', { exact: true })).toBeVisible()
})

test('date dialog sends the chosen date and is accessible', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate')
  await row(page).getByRole('button', { name: 'Duplicate to date', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Duplicate to date', exact: true })
  await expect(dialog.getByLabel('Target date')).toHaveValue('2026-10-02')
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([])
  await dialog.getByLabel('Target date').fill('2026-10-01')
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(row(page, 'entry-copy-1')).toContainText('2026-10-01')
  expect(fixture.calls[0]).toEqual(['entry-1', '2026-10-01'])
})

test('mobile menu exposes duplicate-to-date and Escape closes its dialog', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await dashboardFixture(page, 'duplicate')
  const trigger = row(page).locator('[data-mobile-trigger]')
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Duplicate to date…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Duplicate to date', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('failed duplicate removes its optimistic row', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate', ['entry-1'])
  fixture.hold()
  await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(temps(page)).toHaveCount(1)
  fixture.release()
  await expect(page.getByText('Fixture write rejected', { exact: true })).toBeVisible()
  await expect(temps(page)).toHaveCount(0)
  await expect(row(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled()
})

test('transport failure rolls back the temporary row and releases its lock', async ({ page }) => {
  await dashboardFixture(page, 'duplicate', ['transport:entry-1'])
  await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByText('Could not confirm the duplicate. Please refresh before retrying.', { exact: true })).toBeVisible()
  await expect(temps(page)).toHaveCount(0)
  await expect(row(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled()
})

test('bulk duplicate reports partial failure and clears selection', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'duplicate', ['entry-2'])
  await row(page).getByRole('checkbox').check()
  await row(page, 'entry-2').getByRole('checkbox').check()
  const bulkDuplicate = page.getByRole('button', { name: 'Duplicate', exact: true }).first()
  await expect(bulkDuplicate).toBeEnabled()
  await bulkDuplicate.focus()
  await page.keyboard.press('d')
  await expect(page.getByText('Duplicated 1 of 2; 1 failed: Fixture write rejected', { exact: true })).toBeVisible()
  await expect(temps(page)).toHaveCount(0)
  await expect(row(page, 'entry-copy-1')).toBeVisible()
  await expect(row(page).getByRole('checkbox')).not.toBeChecked()
  expect(fixture.calls).toHaveLength(2)
})

test('bulk delete restores rejected rows even when refresh fails', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'delete', ['entry-2'])
  fixture.failRefresh()
  await row(page).getByRole('checkbox').check()
  await row(page, 'entry-2').getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Deleted 1 of 2; 1 failed: Fixture write rejected', { exact: true })).toBeVisible()
  // A failed read retains the previous authoritative snapshot, including the
  // committed delete, but prevents using it for another write until recovery.
  await expect(row(page)).toBeVisible()
  await expect(row(page, 'entry-2')).toBeVisible()
  await expect(entries(page).getByRole('alert')).toContainText('Fixture refresh failure')
  for (const id of ['entry-1', 'entry-2']) {
    await expect(row(page, id).getByRole('checkbox')).toBeDisabled()
    await expect(row(page, id).getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  }
  await page.keyboard.press('d')
  expect(fixture.calls).toHaveLength(2)
  fixture.recoverRefresh()
  await page.getByRole('button', { name: 'Retry entries', exact: true }).click()
  await expect(row(page)).toHaveCount(0)
  await expect(row(page, 'entry-2').getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
})

test('optimistic edit rolls back when the action rejects it', async ({ page }) => {
  const fixture = await dashboardFixture(page, 'edit', ['entry-1'])
  fixture.hold()
  await row(page).getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('textbox', { name: 'Work Done', exact: true }).fill('Edited optimistically')
  await page.getByRole('table').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(row(page)).toContainText('Edited optimistically')
  fixture.release()
  await expect(page.getByText('Fixture write rejected', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Work Done', exact: true })).toHaveValue('Edited optimistically')
  await page.getByRole('table').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(row(page)).toContainText('Work entry-1')
})

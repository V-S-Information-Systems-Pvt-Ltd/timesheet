// Browser-only transport fixtures: no hosted rows or credentials are mutated.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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
  let signedIn = false
  let failRefresh = false
  let hold = false
  let releaseAction: (() => void) | undefined
  let holdRead = false
  let releaseRead: (() => void) | undefined
  const calls: unknown[][] = []
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`,
    refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user,
  }
  await page.route(/\/auth\/v1\//, async route => {
    signedIn = true
    await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/user') ? user : session })
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/login') {
      signedIn = true
      return route.fulfill({ json: { error: null } })
    }
    if (path === '/api/auth/me') return route.fulfill({ json: { user: signedIn ? user : null } })
    if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Fixture rejects unexpected writes' } })
    if (path === '/api/v1/timesheets') {
      if (failRefresh) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Fixture refresh failure' } } })
      const snapshot = [...rows]
      if (holdRead) {
        holdRead = false
        await new Promise<void>(resolve => { releaseRead = resolve })
      }
      return route.fulfill({ json: { data: { rows: snapshot, count: snapshot.length }, error: null, meta: {} } })
    }
    const data: Record<string, unknown> = {
      '/api/data/profile': profile, '/api/data/profiles': [profile],
      '/api/data/projects': [{ id: 'project-1', name: 'Fixture Project', is_active: true }],
      '/api/data/activity-types': [{ id: 'activity-1', name: 'Development', is_active: true }],
      '/api/data/backfill-window': { mode: 'days', windowDays: 30, extraDays: 0 },
    }
    return route.fulfill({ json: { data: data[path] ?? [], error: null } })
  })
  // Fulfill the framework's action return envelope, never forward fixture writes.
  await page.route(/\/dashboard(?:\?.*)?$/, async route => {
    const request = route.request()
    // The unsigned browser fixture session must never reach server-side Auth.
    if (request.method() !== 'POST') return route.continue({ headers: { ...request.headers(), cookie: '' } })
    let result: object = { error: 'Read-only fixture' }
    const args = JSON.parse(request.postData() ?? '[]') as unknown[]
    if (typeof args[0] === 'string' && args[0].startsWith('entry-')) {
      calls.push(args)
      if (hold) await new Promise<void>(resolve => { releaseAction = resolve })
      const row = rows.find(r => r.id === args[0])!
      if (failures.includes(`transport:${row.id}`)) return route.abort('failed')
      if (failures.includes(row.id)) result = { error: 'Fixture write rejected' }
      else {
        if (operation === 'duplicate') {
          rows = [{ ...row, id: `entry-copy-${calls.length}`, log_date: typeof args[1] === 'string' && args[1] !== '$undefined' ? args[1] : row.log_date }, ...rows]
        } else if (operation === 'delete') rows = rows.filter(r => r.id !== row.id)
        else {
          const input = args[1] as { workDone: string }
          rows = rows.map(r => r.id === row.id ? { ...r, work_done: input.workDone } : r)
        }
        result = {}
      }
    }
    await route.fulfill({ contentType: 'text/x-component', body: `0:${JSON.stringify({ a: result, f: [], b: '' })}\n` })
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
    hold: () => { hold = true },
    release: () => { hold = false; releaseAction?.() },
    failRefresh: () => { failRefresh = true },
    holdRefresh: () => { holdRead = true },
    refreshHeld: () => releaseRead !== undefined,
    releaseRefresh: () => { releaseRead?.() },
    snapshot: () => rows,
  }
}

const row = (page: Page, id = 'entry-1') => page.locator(`[data-row-id="${id}"]`)
const temps = (page: Page) => page.locator('[data-row-id^="temp-"]')

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
  fixture.holdRefresh()
  await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect.poll(fixture.refreshHeld).toBe(true)
  await row(page, 'entry-2').getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect.poll(() => fixture.calls.length).toBe(2)
  await expect.poll(() => fixture.snapshot().length).toBe(4)
  fixture.releaseRefresh()
  await expect(temps(page)).toHaveCount(0)
  await expect(row(page, 'entry-copy-1')).toBeVisible()
  await expect(row(page, 'entry-copy-2')).toBeVisible()
})

for (const rejection of ['edit', 'delete'] as const) {
  test(`rejected ${rejection} does not cancel another duplicate's refresh`, async ({ page }) => {
    const fixture = await dashboardFixture(page, 'duplicate', ['entry-2'])
    fixture.holdRefresh()
    await row(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect.poll(fixture.refreshHeld).toBe(true)
    await row(page, 'entry-2').getByRole('button', { name: rejection === 'edit' ? 'Edit' : 'Delete', exact: true }).click()
    if (rejection === 'edit') {
      await page.getByRole('textbox', { name: 'Work Done', exact: true }).fill('Rejected draft')
      await page.getByRole('table').getByRole('button', { name: 'Save', exact: true }).click()
    } else await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
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
  const trigger = row(page).getByRole('button', { name: 'Entry actions', exact: true })
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Duplicate to date…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Duplicate to date', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('row menu supports keyboard navigation, disabled actions and focus restoration', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const fixture = await dashboardFixture(page, 'duplicate', [], { regular: true, oldSource: true })
  const trigger = row(page).getByRole('button', { name: 'Entry actions', exact: true })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Entry actions' })
  const edit = menu.getByRole('menuitem', { name: 'Edit', exact: true })
  await expect(edit).toBeFocused()
  await expect(edit).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Enter')
  expect(fixture.calls).toHaveLength(0)
  await expect(menu).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Duplicate to date…', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(edit).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

test('short-viewport menu reveals the keyboard-focused action and Tab closes it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 180 })
  await dashboardFixture(page, 'duplicate')
  const trigger = row(page).getByRole('button', { name: 'Entry actions', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Entry actions' })
  await page.keyboard.press('End')
  const action = menu.getByRole('menuitem', { name: 'Delete', exact: true })
  await expect(action).toBeFocused()
  const menuBounds = (await menu.boundingBox())!
  const actionBounds = (await action.boundingBox())!
  expect(actionBounds.y).toBeGreaterThanOrEqual(menuBounds.y)
  expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(menuBounds.y + menuBounds.height)
  expect(await menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)
})

test('mobile menu escapes table clipping, fits the viewport and closes on resize', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await dashboardFixture(page, 'duplicate')
  const trigger = row(page).getByRole('button', { name: 'Entry actions', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Entry actions' })
  await expect(menu).toBeVisible()
  expect(await menu.evaluate(element => element.parentElement === document.body)).toBe(true)
  const bounds = await menu.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(8)
  expect(bounds!.y).toBeGreaterThanOrEqual(8)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(312)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(560)
  const violations = (await new AxeBuilder({ page }).include('[role="menu"]').analyze()).violations
  expect(violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(menu).toHaveCount(0)
  await trigger.click()
  await page.getByRole('heading', { name: /Welcome back/ }).click()
  await expect(menu).toHaveCount(0)
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
  await expect(row(page)).toHaveCount(0)
  await expect(row(page, 'entry-2')).toBeVisible()
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

import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { backfillMinDate } from '../lib/validation'
import { openNav } from './browser-fixture'

// Root runs this on the explicitly designated seeded native test server.
test.skip(!process.env.E2E_BASE_URL,
  'Requires the isolated native production server, not fake browser login routes.')

async function signIn(request: APIRequestContext, context?: BrowserContext) {
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD
  if (!email || !password) throw new Error('Seeded E2E credentials are required.')
  const response = await request.post('/api/v1/auth/browser/login', {
    data: { email, password }, headers: { Origin: process.env.E2E_BASE_URL! },
  })
  expect(response.ok()).toBe(true)
  expect((await response.json()).error).toBeFalsy()
  const storage = await request.storageState()
  expect(storage.cookies.length).toBeGreaterThan(0)
  if (context) await context.addCookies(storage.cookies)
  // Explicitly transport the real Secure test cookie for HTTP server-only probes.
  return storage.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

test('native cookie SSR contains the sidebar navigation and bounded table before client JavaScript', async ({ request }) => {
  const cookie = await signIn(request)
  const response = await request.get('/dashboard?tab=user&panel=entries&size=50', { headers: { Cookie: cookie } })
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html).toContain('aria-label="Main"')
  expect(html).toMatch(/<tr[^>]*data-row-id=/)
  expect(html).not.toContain('password_hash')
  expect(html).not.toContain('session_version')
  await request.post('/api/v1/auth/browser/logout', { headers: { Origin: process.env.E2E_BASE_URL! } })
  const signedOut = await request.get('/dashboard')
  expect(await signedOut.text()).not.toContain('aria-label="Main"')
})

test('hydration retains seeded reads and local pager/tab navigation performs no RSC seed work', async ({ request, context, page }) => {
  await signIn(request, context)
  const seededReads: string[] = []
  const rsc: string[] = []
  const localReads: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/dashboard' && request.headers().rsc === '1' && request.headers()['next-router-prefetch'] !== '1') rsc.push(request.url())
    if (['/api/v1/profile', '/api/v1/reference', '/api/v1/people', '/api/v1/layout/web',
      '/api/v1/settings/backfill', '/api/v1/capabilities', '/api/v1/reports'].includes(url.pathname) &&
      !(url.pathname === '/api/v1/reference' && (url.searchParams.get('all') === '1' || url.searchParams.get('only') === 'titles'))) seededReads.push(url.pathname)
    if (url.pathname === '/api/v1/timesheets') localReads.push(url.search)
  })
  await page.goto('/dashboard?tab=user&panel=entries&size=50')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  const table = page.locator('section').filter({ has: page.getByRole('heading', { name: /^(My )?Recent Entries$/ }) })
  await expect(table.getByLabel('Entries per page')).toHaveValue('50')
  // Today, shortcuts, inactive types and profile-title suggestions are independent.
  await expect.poll(() => localReads.some(query => new URLSearchParams(query).get('includeCount') === 'false')).toBe(true)
  expect(localReads.filter(query => new URLSearchParams(query).get('to') === '49')).toHaveLength(0)
  expect(seededReads).toEqual([])
  await table.getByLabel('Entries per page').selectOption('25')
  await expect(page).toHaveURL(/size=25/)
  await expect(table.getByLabel('Entries per page')).toHaveValue('25')
  // Any sidebar move proves in-place navigation; avoid admin-only panels so a
  // regular test account can run this against a deployed site.
  await openNav(page, 'My timesheet', 'Leave')
  await expect(page).toHaveURL(/panel=leave/)
  await openNav(page, 'My timesheet', 'Recent Entries')
  await expect(table).toBeVisible()
  expect(rsc).toEqual([])
})

// Live accounts' entries age out of the backfill window, so seed a writable
// legacy-format row (the bulk dialog's Activity Type field) and return its id.
async function seedWritableEntry(request: APIRequestContext, cookie: string) {
  const headers = { Cookie: cookie, Origin: process.env.E2E_BASE_URL! }
  const reference = (await (await request.get('/api/v1/reference', { headers })).json()).data
  const project = reference.projects.find((p: { is_timesheet_project?: boolean }) => p.is_timesheet_project !== false)
  const activityType = reference.activityTypes[0]
  expect(project && activityType, 'test account needs a project and an activity type').toBeTruthy()
  // UTC today is within today/yesterday for the runner's browser and a UTC+ server.
  const logDate = new Date().toISOString().slice(0, 10)
  const workDone = `e2e dashboard-ssr bulk lock ${Date.now()}`
  const created = await request.post('/api/v1/timesheets', {
    headers, data: { projectId: project.id, activityTypeId: activityType.id, hoursWorked: 0.25, workDone, logDate },
  })
  expect(created.status(), await created.text()).toBe(201)
  const list = await (await request.get(`/api/v1/timesheets?dateFrom=${logDate}&dateTo=${logDate}`, { headers })).json()
  const id = list.data.rows.find((row: { work_done: string }) => row.work_done === workDone)?.id as string | undefined
  expect(id).toBeTruthy()
  return { id: id!, remove: () => request.delete(`/api/v1/timesheets/${id}`, { headers }) }
}

test('delayed initial confirmation cannot release seeded bulk mutation locks', async ({ request, context, page }) => {
  const cookie = await signIn(request, context)
  const entry = await seedWritableEntry(request, cookie)
  try {
    const identity = await (await request.get('/api/v1/auth/browser/me', { headers: { Cookie: cookie } })).json()
    let releaseIdentity: (() => void) | undefined
    let releaseWrite: (() => void) | undefined
    let duplicateProfiles = 0
    await page.route('**/api/v1/auth/browser/me', async route => {
      await new Promise<void>(resolve => { releaseIdentity = resolve })
      await route.fulfill({ json: identity })
    })
    await page.route('**/api/v1/profile', async route => {
      duplicateProfiles++
      await route.continue()
    })
    await page.route('**/api/v1/timesheets/batch-update', async route => {
      await new Promise<void>(resolve => { releaseWrite = resolve })
      // Deterministic failure: never write test entries to the database.
      await route.fulfill({ status: 503, json: { data: null, error: { message: 'SSR fixture batch rejected' } } })
    })
    await page.goto('/dashboard?tab=user&panel=entries&size=50', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect.poll(() => Boolean(releaseIdentity)).toBe(true)
    const table = page.locator('section').filter({ has: page.getByRole('heading', { name: /^(My )?Recent Entries$/ }) })
    await table.locator(`tr[data-row-id="${entry.id}"]`).getByRole('checkbox').check()
    await table.getByRole('button', { name: 'Bulk Edit', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Activity Type', { exact: true }).selectOption({ index: 1 })
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(() => Boolean(releaseWrite)).toBe(true)
    releaseIdentity!()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).first()).toBeDisabled()
    await expect(table.getByLabel('Entries per page')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    expect(duplicateProfiles).toBe(0)
    releaseWrite!()
    await expect(dialog).toHaveCount(0)
    await expect(table.getByLabel('Entries per page')).toBeEnabled()
    await expect(page.getByText('SSR fixture batch rejected', { exact: true })).toBeVisible()
  } finally {
    await entry.remove()
  }
})

test.describe('browser-local calendar boundary', () => {
  test.use({ timezoneId: 'UTC' })
  test('hydrates without date errors then enables the browser-local date and backfill bounds', async ({ request, context, page }) => {
    const cookie = await signIn(request, context)
    const settings = await (await request.get('/api/v1/settings/backfill', { headers: { Cookie: cookie } })).json()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    // A different calendar year makes disagreement deterministic; timers still run.
    await page.clock.setFixedTime(new Date('2099-01-01T00:05:00Z'))
    await page.goto('/dashboard?tab=user&panel=entry-form')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Log Time', exact: true }) })
    const date = form.getByLabel('Date', { exact: true })
    await expect(date).toBeEnabled()
    await expect(date).toHaveValue('2099-01-01')
    await expect(date).toHaveAttribute('max', '2099-01-01')
    const minimum = backfillMinDate('2099-01-01', settings.data)
    await expect(date).toHaveAttribute('min', minimum)
    await expect(form).toContainText(`Writable from ${minimum}`)
    expect(errors).toEqual([])
  })
})

import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { backfillMinDate } from '../lib/validation'

// Root runs this on the explicitly designated seeded native test server.
test.skip(process.env.NEXT_PUBLIC_BACKEND !== 'native' || !process.env.E2E_BASE_URL,
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

test('native cookie SSR contains the welcome header and bounded table before client JavaScript', async ({ request }) => {
  const cookie = await signIn(request)
  const response = await request.get('/dashboard?size=50', { headers: { Cookie: cookie } })
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html).toMatch(/<h1[^>]*>Welcome back,/)
  expect(html).toMatch(/<tr[^>]*data-row-id=/)
  expect(html).not.toContain('password_hash')
  expect(html).not.toContain('session_version')
  await request.post('/api/v1/auth/browser/logout', { headers: { Origin: process.env.E2E_BASE_URL! } })
  const signedOut = await request.get('/dashboard')
  expect(await signedOut.text()).not.toMatch(/<h1[^>]*>Welcome back,/)
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
  await page.goto('/dashboard?size=50')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible()
  const table = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent Entries', exact: true }) })
  await expect(table.getByLabel('Entries per page')).toHaveValue('50')
  // Today, shortcuts, Telegram, inactive types and profile-title suggestions are independent.
  await expect.poll(() => localReads.some(query => new URLSearchParams(query).get('includeCount') === 'false')).toBe(true)
  expect(localReads.filter(query => new URLSearchParams(query).get('to') === '49')).toHaveLength(0)
  expect(seededReads).toEqual([])
  await table.getByLabel('Entries per page').selectOption('25')
  await expect(page).toHaveURL(/size=25/)
  await expect(table.getByLabel('Entries per page')).toHaveValue('25')
  await page.getByRole('button', { name: 'Admin Panel', exact: true }).click()
  await expect(page).toHaveURL(/tab=admin/)
  await page.getByRole('button', { name: 'My Timesheet', exact: true }).click()
  await expect(table).toBeVisible()
  expect(rsc).toEqual([])
})

test('delayed initial confirmation cannot release seeded bulk mutation locks', async ({ request, context, page }) => {
  const cookie = await signIn(request, context)
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
  await page.goto('/dashboard?size=50', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible()
  await expect.poll(() => Boolean(releaseIdentity)).toBe(true)
  const table = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent Entries', exact: true }) })
  await table.getByRole('checkbox', { name: 'Select entries on this page' }).check()
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
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible()
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

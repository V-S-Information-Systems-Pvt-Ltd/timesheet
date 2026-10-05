import { expect, type Page, type Route } from '@playwright/test'

const unexpectedRequests = new WeakMap<Page, string[]>()

export async function rejectFixtureRequest(page: Page, route: Route) {
  const request = route.request()
  unexpectedRequests.get(page)!.push(`${request.method()} ${request.url()}`)
  return route.fulfill({ status: 405, json: { data: null, error: { message: 'Fixture rejects unexpected writes' } } })
}

export function expectFixtureIsolation(page: Page) {
  expect(unexpectedRequests.get(page), 'All writes must use explicitly mocked v1 operations; no Server Actions').toEqual([])
}

// Both auth providers are browser-only fixtures. Only cookie-free framework
// reads may reach the local production server; application APIs never do.
export async function installBrowserFixture(page: Page, identity: { id: string; email: string }) {
  const unexpected: string[] = []
  unexpectedRequests.set(page, unexpected)
  page.on('request', request => {
    if (request.headers()['next-action']) unexpected.push(`Server Action ${request.url()}`)
  })
  const user = { ...identity, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} }
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`,
    refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user,
  }
  let signedIn = false
  await page.route('**/*', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (request.headers()['next-action']) return rejectFixtureRequest(page, route)
    if (path.startsWith('/auth/v1/')) {
      if (method === 'POST' && path === '/auth/v1/token') {
        signedIn = true
        return route.fulfill({ json: session })
      }
      if (method === 'GET' && path === '/auth/v1/user') return route.fulfill({ json: user })
      if (method === 'POST' && path === '/auth/v1/logout') {
        signedIn = false
        return route.fulfill({ status: 204 })
      }
      return rejectFixtureRequest(page, route)
    }
    if (method === 'POST' && path === '/api/v1/auth/browser/login') {
      signedIn = true
      return route.fulfill({ json: { error: null } })
    }
    if (method === 'GET' && path === '/api/v1/auth/browser/me') return route.fulfill({ json: { user: signedIn ? identity : null } })
    if (method === 'POST' && path === '/api/v1/auth/browser/logout') {
      signedIn = false
      return route.fulfill({ json: { error: null } })
    }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) return rejectFixtureRequest(page, route)
    // Supabase's unsigned fixture cookie must not enter SSR authentication,
    // including document reloads, RSC navigation and prefetches.
    return route.continue({ headers: { ...request.headers(), cookie: '' } })
  })
}

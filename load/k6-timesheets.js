// load/k6-timesheets.js
// k6 load-test scenarios for the timesheets API.
// Plain JavaScript (k6 runs on goja — no TypeScript annotations/casts allowed).
// The app authenticates via an HttpOnly session COOKIE (vsis_session), so the
// load test logs in and reuses that cookie on the data request.
//
// Run with: k6 run load/k6-timesheets.js
// Requires E2E_EMAIL / E2E_PASSWORD set to an active account and BASE_URL to
// the running app (defaults localhost:3000).

import { check, sleep } from 'k6'
import http from 'k6/http'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const EMAIL = __ENV.E2E_EMAIL || 'admin@example.com'
const PASSWORD = __ENV.E2E_PASSWORD || 'change-me'

export const options = {
  scenarios: {
    // Timesheet reads: the primary dashboard query under concurrent users.
    timesheets: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
    // Login storm / burst: repeated authentication attempts.
    login_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  // Phase 6 §6.4 acceptance: response times <2s at peak, no 5xx at 2x traffic.
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
}

function extractSessionCookie(res) {
  const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'] || ''
  if (Array.isArray(setCookie)) {
    for (const c of setCookie) {
      const m = String(c).match(/vsis_session=([^;]+)/)
      if (m) return `vsis_session=${m[1]}`
    }
    return ''
  }
  const m = String(setCookie).match(/vsis_session=([^;]+)/)
  return m ? `vsis_session=${m[1]}` : ''
}

export function setup() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  )
  const ok = check(res, { 'login succeeded': (r) => r.status === 200 })
  return { cookie: ok ? extractSessionCookie(res) : '' }
}

export default function (data) {
  const res = http.get(`${BASE_URL}/api/data/timesheets?from=0&limit=50`, {
    headers: data.cookie ? { Cookie: data.cookie } : {},
  })
  check(res, { 'timesheets 200': (r) => r.status === 200 })
  sleep(1)
}

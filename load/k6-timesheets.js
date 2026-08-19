// load/k6-timesheets.js
// k6 load test scenario for the timesheets API.
// Run with: k6 run load/k6-timesheets.js

import { check, sleep } from 'k6'
import http from 'k6/http'

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const EMAIL = __ENV.E2E_EMAIL || 'admin@example.com'
const PASSWORD = __ENV.E2E_PASSWORD || 'change-me'

let token = ''

export function setup() {
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  })
  check(res, { 'login succeeded': (r) => r.status === 200 })
  const body = JSON.parse(res.body as string)
  token = body.user?.id || ''
  return { token }
}

export default function (data: { token: string }) {
  const res = http.get(`${BASE_URL}/api/data/timesheets?from=0&limit=50`, {
    headers: { Authorization: `Bearer ${data.token}` },
  })
  check(res, { 'timesheets 200': (r) => r.status === 200 })
  sleep(1)
}

export function teardown() {}

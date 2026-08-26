#!/usr/bin/env node
/**
 * Mobile bearer-auth smoke test (WP-03/WP-07 exit gate).
 *
 * Exercises the full /api/v1 lifecycle against a running VSIS deployment in
 * either backend mode:
 *
 *   login -> me -> protected reads -> refresh -> reuse rejection ->
 *   immediate revocation -> logout -> post-logout rejection
 *
 * Usage:
 *   BASE_URL=https://timesheet.example.com \
 *   MOBILE_SMOKE_EMAIL=you@example.com \
 *   MOBILE_SMOKE_PASSWORD='secret' \
 *   node scripts/mobile-smoke.mjs
 *
 * Exits non-zero on the first failed expectation.
 */

const BASE_URL = (process.env.MOBILE_SMOKE_URL ?? process.env.BASE_URL ?? '').replace(/\/+$/, '');
const EMAIL = process.env.MOBILE_SMOKE_EMAIL ?? process.env.E2E_EMAIL;
const PASSWORD = process.env.MOBILE_SMOKE_PASSWORD ?? process.env.E2E_PASSWORD;

if (!BASE_URL || !EMAIL || !PASSWORD) {
  console.error('Set MOBILE_SMOKE_URL/BASE_URL, MOBILE_SMOKE_EMAIL/E2E_EMAIL and MOBILE_SMOKE_PASSWORD/E2E_PASSWORD.');
  process.exit(2);
}

let failures = 0;

function check(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, { method = 'GET', accessToken, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let envelope = null;
  try {
    envelope = await response.json();
  } catch {
    envelope = null;
  }
  return { status: response.status, requestId: response.headers.get('x-request-id'), body: envelope };
}

function code(result) {
  return result.body?.error?.code ?? '(none)';
}

async function main() {
  const config = await api('/api/v1/config');
  check(
    'config responds',
    config.status === 200 && config.body?.data?.capabilities?.mobileApi === true,
    `status=${config.status}`,
  );
  if (!config.requestId) console.log('WARN X-Request-Id missing on /config');

  // Two independent device sessions: one to prove reuse detection, one for the
  // happy path so the reuse-revoked family cannot mask later checks.
  const login = async () =>
    api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: EMAIL.toLowerCase(), password: PASSWORD, deviceName: 'smoke', platform: 'android' },
    });

  const first = await login();
  check('login issues a token pair', first.status === 200 && Boolean(first.body?.data?.accessToken), `code=${code(first)}`);
  const wrongPassword = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { email: EMAIL.toLowerCase(), password: `${PASSWORD}-wrong` },
  });
  check(
    'wrong password is indistinguishable from unknown user',
    wrongPassword.status === 401 && code(wrongPassword) === 'INVALID_CREDENTIALS',
    `code=${code(wrongPassword)}`,
  );

  const second = await login();
  check('second device session created', second.status === 200 && Boolean(second.body?.data?.sessionId));
  if (!first.body?.data || !second.body?.data) {
    console.error('Cannot continue without two sessions; aborting.');
    process.exit(1);
  }
  const sessionA = first.body.data;
  const sessionB = second.body.data;

  const meA = await api('/api/v1/auth/me', { accessToken: sessionA.accessToken });
  check('me returns the actor', meA.status === 200 && meA.body?.data?.id === sessionA.actor.id);

  const dashboard = await api('/api/v1/dashboard', { accessToken: sessionB.accessToken });
  check('dashboard loads in one round trip', dashboard.status === 200 && Array.isArray(dashboard.body?.data?.recentEntries));

  const timesheets = await api('/api/v1/timesheets?limit=5', { accessToken: sessionB.accessToken });
  check('timesheets page loads', timesheets.status === 200 && Array.isArray(timesheets.body?.data?.rows));

  const reference = await api('/api/v1/reference', { accessToken: sessionB.accessToken });
  check('reference data loads', reference.status === 200 && Array.isArray(reference.body?.data?.projects));

  const rotated = await api('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: sessionA.refreshToken } });
  check('refresh rotates the family', rotated.status === 200 && Boolean(rotated.body?.data?.refreshToken));

  const reused = await api('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: sessionA.refreshToken } });
  check('reuse of a rotated token is rejected', reused.status === 401 && code(reused) === 'REFRESH_TOKEN_REUSED', `code=${code(reused)}`);

  const revokedRead = await api('/api/v1/auth/me', { accessToken: rotated.body.data.accessToken });
  check('reuse revokes the whole family immediately', revokedRead.status === 401, `code=${code(revokedRead)}`);

  const noAuth = await api('/api/v1/auth/me');
  check('missing bearer is rejected without cookie fallback', noAuth.status === 401 && code(noAuth) === 'AUTH_REQUIRED');

  const forged = await api('/api/v1/dashboard', { accessToken: `${sessionB.accessToken.slice(0, -2)}xx` });
  check('tampered access token is rejected', forged.status === 401);

  const rotatedB = await api('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: sessionB.refreshToken } });
  check('second session still rotates cleanly', rotatedB.status === 200);

  const meB = await api('/api/v1/auth/me', { accessToken: rotatedB.body.data.accessToken });
  check('me works after rotation', meB.status === 200);

  const loggedOut = await api('/api/v1/auth/logout', { method: 'POST', accessToken: rotatedB.body.data.accessToken });
  check('logout revokes the current device', loggedOut.status === 200);

  const afterLogout = await api('/api/v1/auth/me', { accessToken: rotatedB.body.data.accessToken });
  check('post-logout access is rejected', afterLogout.status === 401, `code=${code(afterLogout)}`);

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`Smoke run aborted: ${err?.message ?? err}`);
  process.exit(1);
});

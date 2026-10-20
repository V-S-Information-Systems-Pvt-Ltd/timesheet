---
name: verify
description: Pick and run the right local checks for a change in this repo (web, DB, e2e, mobile) without re-deriving them from package.json and CI. Use before claiming a change works, before committing, or when asked to "run the checks".
---

# Verify a change

Source of truth: `package.json`, `mobile/package.json`, `.github/workflows/ci.yml`. Run from the repo root unless noted. Prefix noisy commands with `rtk`; report a failure digest, not full logs.

## Pick checks by what changed

| Changed | Run |
|---|---|
| Any TS under `app/`, `lib/`, `packages/` | `npm run lint` · `npm run typecheck` · `npx vitest run <related tests>` |
| Before commit / PR (web) | `npm run lint` · `npm run typecheck` · `npm test` |
| Coverage-sensitive (`lib/**`, `app/api/**`, auth/security files) | `npm run test:coverage` (gates in `vitest.config.mts`) |
| `db/migrations/`, `lib/db/native/`, SQL, idempotency, concurrency | DB integration (below) |
| Routing, config, server components, `next.config.ts` | `npm run build` (includes type checking) |
| UI flows | Playwright e2e + `npm run a11y` (below) |
| `mobile/` | `cd mobile && npm run lint && npm run typecheck && npm test` |
| Docs only | Check paths/links and the diff; no test run |

## DB integration (needs `TEST_DATABASE_URL` → migrated Postgres)

```bash
npm run db:migrate && npm run db:seed
npx vitest run --no-file-parallelism tests/idempotency.int.test.ts tests/restore.int.test.ts tests/sum-hours.int.test.ts tests/password-change-race.int.test.ts tests/parity-tracer.test.ts
npm run db:concurrency-test
npm run db:password-recovery-test
```

No database available → say the DB tests were skipped. Never report them as passing.

## E2E (production standalone server, see `playwright.config.ts`)

```bash
npm run db:seed && node scripts/seed-deterministic-matrix.mjs && node scripts/verify-e2e-fixtures.mjs
npm run build
npm run e2e
npm run a11y
```

Needs seeded `E2E_EMAIL` / `E2E_PASSWORD`. Run a single spec with `npx playwright test e2e/<spec>.ts`.

## Report

List each check as passed, failed, or skipped, with the reason for any skip. Include only the failing test names and the first error lines.

# Mobile Supabase migration history audit

**Date:** 2026-09-01  
**CLI:** Supabase 2.113.0  
**Target:** linked project (read-only audit)

## Result

`supabase migration list --linked` reported matching local and remote versions
from `20260810160000` through `20260910000000`, including
`20260905000000`.

That match is insufficient evidence that the linked database has the fixed
`rotate_mobile_session` body: version `20260905000000` was previously used by
different SQL on an upstream branch. Supabase compares migration versions, not
file content, so the remote history cannot establish which body was applied.

## Local reconciliation status

- Local migration timestamp prefixes are unique.
- The existing rotation repair remains at the ambiguous historical version and
  must not be deployed as evidence of the fix.
- `supabase migration new fix_mobile_session_rotation` was tried with the
  installed CLI. It generated `20260901104737`, which sorts before existing
  migrations through `20260910000000`; the empty generated file was removed
  because applying the rotation replacement before `mobile_sessions` exists
  would be invalid.

## Required operator actions

1. Take a recoverable backup/snapshot of every target environment.
2. Inspect the live `public.rotate_mobile_session(text, text, timestamptz)`
   body and its grants, without relying on version history alone.
3. Create the forward repair after the actual migration head using the agreed
   release clock/version policy, then verify it against a clean database.
4. Use `supabase migration repair` only after the schema/history matrix proves
   a mismatch. It has not been run by this implementation.

No database schema or migration history was modified during this audit.

## Forward repair — release-owner decision recorded (2026-09-01)

**R1.2 policy decision (operator/release owner, accepted):** allocate a
monotonic post-head version through the repository's approved process —
no reconciliation of the future-dated chain.

Implemented as a result:

- `supabase/migrations/20260910000001_pin_mobile_session_rotation.sql`
  - re-creates `public.rotate_mobile_session(text, text, timestamptz)` with the
    aliased/qualified body originally carried by `20260905000000`,
  - pins `set search_path = public, pg_temp` (both earlier bodies pinned only
    `public`),
  - `revoke all ... from public, anon, authenticated` and
    `grant execute ... to service_role` (unchanged),
  - `create or replace` is safe whether the target already has the original or
    corrected body.
- `20260905000000_fix_mobile_session_rotation.sql` is **retained** for now.
  Removal requires clean-database application proof plus a separately approved
  operator runbook (a removed file would leave applied remote versions without
  a local file, forcing `supabase migration repair --reverted`). Neither has
  been performed by this pass, so the file stays.
- `tests/supabase-migrations.test.ts` now requires the latest rotation
  definition to be the post-head pin migration and asserts its grants,
  `search_path`, and qualified table references.

## Environment matrix (R1.1)

| Environment | Backup/snapshot | Operator | `supabase migration list` | Live function hash | Owner / prosecdef / search_path / grants |
| --- | --- | --- | --- | --- | --- |
| local | none provisioned — repo has no `supabase/config.toml` or running stack | — | not run | n/a | n/a |
| development | pending operator | pending operator | pending operator | pending operator | pending operator |
| staging | pending operator | pending operator | pending operator | pending operator | pending operator |
| production | pending operator | pending operator | pending operator | pending operator | pending operator |

The local environment could not be probed from this workspace (no local
Supabase stack, no linked project credentials). The non-production refresh
rotation and reuse-detection probe against the real RPC must be run by the
operator on the provisioned local stack using the post-head definition; the
result is to be recorded here without retaining refresh-token material.

## Remediation implementation record (2026-09-01, branch `mobile-dev`)

Implemented by the review-findings fix pass (do not mutate history without a
separately approved runbook):

- `supabase/migrations/20260910000001_pin_mobile_session_rotation.sql` —
  unambiguous post-head version for the corrected
  `public.rotate_mobile_session(text, text, timestamptz)` (aliased + qualified
  body, `set search_path = public, pg_temp`, execute granted to
  `service_role` only; revoked from `public`, `anon`, `authenticated`).
  `create or replace` is idempotent against both the original and corrected
  bodies.
- The ambiguous `20260905000000_fix_mobile_session_rotation.sql` is retained;
  removal requires clean-database application proof and an approved operator
  runbook (not performed).
- `tests/supabase-migrations.test.ts` now asserts the latest rotation
  definition is the post-head pin migration, its grants, `search_path`, and
  aliased/qualified references.

Reproduced in this pass (commit `3bf7ec8` + uncommitted remediation delta):

```
npx vitest run tests/supabase-migrations.test.ts        # 17 passed
npx vitest run tests/mobile-session-store.test.ts
  tests/mobile-admin-reports-export-route.test.ts
  tests/mobile-branding-route.test.ts tests/branding.test.ts
  tests/action-policy.test.ts                            # 40 passed
```

Refresh-rotation and reuse-detection probes through the real RPC remain to be
run by the operator on the provisioned local stack, with results recorded here
without retaining refresh-token material. Dev/staging/production history and
live function-body/grant probes remain `pending operator` as in the matrix
above.

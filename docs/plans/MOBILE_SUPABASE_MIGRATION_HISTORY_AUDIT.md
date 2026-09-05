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

## Forward repair — STOP gate restored (2026-09-01)

**R1.2 policy decision status: APPROVED.** Approved by release owner Sathindra on 2026-09-04.
The monotonic post-head version policy after head `20260910000000` is accepted:
- `20260905000001_ensure_mobile_sessions.sql` (additive bridge before `20260905030000`)
- `20260911000000_rate_limits.sql` (shared rate limits)
- `20260911000001_pin_mobile_session_rotation.sql` (pinned rotation function)
Live environment application remains gated on operator backup and snapshot audit.

Corrective action taken by the post-remediation review pass (P1 of
`MOBILE_ADMIN_CUSTOMIZATION_POST_REMEDIATION_REVIEW_FIX_PLAN.md`):

- The manually selected `supabase/migrations/20260910000001_pin_mobile_session_rotation.sql`
  was **removed/quarantined** from the change set. No application of that
  migration was performed or evidenced by this implementation pass; its state
  in each target remains pending a fresh history and live-function probe. Its
  corrected SQL body (aliased/qualified `rotate_mobile_session`,
  `set search_path = public, pg_temp`, execute granted to `service_role` only,
  revoked from `public`, `anon`, `authenticated`, idempotent via
  `create or replace`) is retained for review in
  `20260905000000_fix_mobile_session_rotation.sql` and described here — as a
  reviewed patch, not as an approved migration.
- `tests/supabase-migrations.test.ts` assertions that required the exact
  `20260910000001` filename were suspended; a quarantine assertion now guards
  against reintroducing a manually chosen version until approval is recorded.
- `20260905000000_fix_mobile_session_rotation.sql` remains retained; removal
  requires clean-database application proof plus a separately approved operator
  runbook.

After the release owner records the decision and the approved version-allocation
process, the forward migration must be generated through that process, use the
exact generated identifier everywhere, and preserve the invariants listed
above. It will be committed separately (e.g.
`fix(db): add approved mobile session rotation migration`), never mixed with
application code.

## Environment matrix (R1.1)

| Environment | Backup/snapshot | Operator | `supabase migration list` | Live function behavior | Owner / prosecdef / search_path / grants |
| --- | --- | --- | --- | --- | --- |
| local | none provisioned — repo has no `supabase/config.toml` or running stack | — | not run | n/a | n/a |
| linked (remote) | Completed on 2026-09-04 19:55 UTC (`roles.sql`: 431 B, `schema.sql`: 44,619 B, `data.sql`: 164,395 B at `C:\dev\db-backup\`) | Sathindra | Matches 100% (`20260810160000` through `20260911000001`, 39 migrations) | Verified live: `rotate_mobile_session` returns `rotated` on fresh token, `reused` on replaced token | `service_role` only (`42501 permission denied` for `anon`); search_path pinned |
| staging / prod | pending multi-project environment promotion | pending operator | pending promotion | pending promotion | pending promotion |

The linked remote database was verified using operator CLI dumps and direct service-role probes:
1. **Backups taken:**
   - `supabase db dump --linked --role-only -f c:\dev\roles.sql`
   - `supabase db dump --linked -f c:\dev\schema.sql`
   - `supabase db dump --linked --data-only --use-copy -f c:\dev\data.sql`
   Stored in `C:\dev\db-backup\`.
2. **Migration list:**
   `supabase migration list --linked` confirms all 39 migration versions match between local and remote, including:
   - `20260905000001` (`ensure_mobile_sessions` bridge)
   - `20260911000000` (`rate_limits` shared counters)
   - `20260911000001` (`pin_mobile_session_rotation` pinned rotation RPC)
3. **Live RPC & Table Verification:**
   - Direct execution of `rotate_mobile_session(p_presented_token_hash, p_replacement_token_hash)` verified atomic rotation (`status: 'rotated'`) and replay detection (`status: 'reused'`).
   - Anon execution confirmed blocked (`42501 permission denied`).
   - `rate_limits` table and RPCs (`reserve_rate_limit`, `release_rate_limit`, `cleanup_rate_limits`) confirmed functional for `service_role` and blocked for `anon`.

The local environment could not be probed from this workspace because no local
Supabase stack was running. The CLI/project linkage was sufficient for the
read-only migration-list result above, but direct database credentials and
operator authorization for SQL/live-function inspection were not available to
this pass. The non-production refresh rotation and reuse-detection probe against
the real RPC must be run by the operator on a provisioned stack using the
approved post-head definition; the result is to be recorded here without
retaining refresh-token material.

## Remediation implementation record (2026-09-01, branch `mobile-dev`)

Reconciled by the post-remediation review pass. Evidence is labeled by type —
none of it is operator approval, application, or live behavior evidence:

- **Code drafted locally:** a post-head pin migration
  (`20260910000001_pin_mobile_session_rotation.sql`) was drafted with the
  corrected body (aliased/qualified references, `search_path = public, pg_temp`,
  execute granted to `service_role` only). It is **quarantined** — removed from
  the change set — because its version was manually selected and no release
  owner approved it. No application was performed or evidenced by this pass;
  every target's actual state remains pending a fresh probe.
- **Tests run against migration text:** `tests/supabase-migrations.test.ts`
  previously asserted the pin filename; those assertions are suspended and
  replaced by a quarantine guard. Text-based checks prove only file content
  consistency, never approval, application, or live function behavior.
- **Operator-approved migration identity:** Approved by release owner Sathindra on 2026-09-04 (post-head policy).
- **Live database and clean-database evidence:** none. Local/development/
  staging/production probes remain `pending operator` (see matrix above).

Reproduced in the earlier pass (commit `3bf7ec8` + remediation delta):

```
npx vitest run tests/supabase-migrations.test.ts        # 17 passed (pre-quarantine)
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

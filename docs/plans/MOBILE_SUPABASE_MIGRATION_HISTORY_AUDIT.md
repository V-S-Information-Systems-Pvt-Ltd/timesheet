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
| linked (remote) | Completed on 2026-09-04 19:55 UTC (`roles.sql`: 431 B, `schema.sql`: 44,619 B, `data.sql`: 164,395 B at `C:\dev\db-backup\`) | Sathindra | Matches 100% (`20260810160000` through `20260912000000`, 46 migrations) | Verified live: `rotate_mobile_session` returns `rotated` on fresh token, `reused` on replaced token | `service_role` only (`42501 permission denied` for `anon`); search_path pinned |
| staging / prod | pending multi-project environment promotion | pending operator | pending promotion | pending promotion | pending promotion |

The linked remote database was verified using operator CLI dumps, `supabase db push`, and direct service-role probes:
1. **Backups taken:**
   - `supabase db dump --linked --role-only -f c:\dev\roles.sql`
   - `supabase db dump --linked -f c:\dev\schema.sql`
   - `supabase db dump --linked --data-only --use-copy -f c:\dev\data.sql`
   - `supabase db dump --linked -f c:\dev\schema-pre-remediation.sql` (50,985 B, 2026-09-05)
   Stored in `C:\dev\db-backup\` and `C:\dev\`.
2. **Migration list:**
   `supabase migration list --linked` confirms all 46 migration versions match between local and remote (`20260810160000` through `20260912000000`), including:
   - `20260905000001` (`ensure_mobile_sessions` bridge)
   - `20260911000000` (`rate_limits` shared counters)
   - `20260911000001` (`pin_mobile_session_rotation` pinned rotation RPC)
   - `20260912000000` (`advisor_security_remediation` search-path & grant hardening)
3. **Live RPC & Table Verification (Linked Remote):**
   - Direct execution of `rotate_mobile_session(p_presented_token_hash, p_replacement_token_hash)` verified atomic rotation (`status: 'rotated'`) and replay detection (`status: 'reused'`).
   - Anon execution confirmed blocked (`42501 permission denied`).
   - `rate_limits` table and RPCs (`reserve_rate_limit`, `release_rate_limit`, `cleanup_rate_limits`) confirmed functional for `service_role` and blocked for `anon`.
   - Security advisor warnings: mutable search paths on `check_daily_hours_limit` and `sync_legacy_role` resolved; `handle_new_user` revoked from public/anon/authenticated; RLS helpers revoked from public/anon and granted to authenticated.

### Evidence Boundaries & Clean-Database Status

- **Linked remote database:** Verified live via operator CLI dumps, `supabase migration list --linked`, `supabase db push`, and direct service-role probes.
- **Local clean-database execution:** No local Supabase stack is running in this Windows workspace (`C:\dev\timesheet`), so a fresh end-to-end migration run against an empty, disposable Supabase stack has not been performed locally. Full clean-database convergence against a blank stack remains an open verification item for a provisioned local/CI environment.
- **Native migration numbering exception:** `db/migrations/` contains two files prefixed `0017_` (`0017_bound_leave_reminder_text.sql` and `0017_mobile_sessions.sql`). The plain-JS runner `db/migrate-runner.mjs:28` stores and keys migrations by complete filename (`name` column in `_migrations`), executing in alphabetical sort order (`0017_bound_...` before `0017_mobile_...`). Neither migration may be renamed, as renaming an applied migration causes `_migrations` checksum mismatch or re-execution.

## Remediation implementation history

1. **Initial draft (2026-09-01):** A post-head pin migration (`20260910000001_pin_mobile_session_rotation.sql`) was drafted and quarantined pending release-owner decision.
2. **Policy decision (2026-09-04):** Release owner Sathindra approved the monotonic post-head version policy after `20260910000000`:
   - `20260905000001_ensure_mobile_sessions.sql` (additive bridge)
   - `20260911000000_rate_limits.sql`
   - `20260911000001_pin_mobile_session_rotation.sql`
3. **Security advisor remediation (2026-09-05):** Added `20260912000000_advisor_security_remediation.sql` (and native `0025_advisor_security_remediation.sql`), tested via dry-run and applied to the linked database, resolving 8 security advisor warnings.
4. **Scope boundary:** The workspace evaluated is strictly `C:\dev\timesheet`. The unmanaged checkout at `C:\dev\vsis-timesheet` (older commit `b6fc11d`) is not part of this remediation.

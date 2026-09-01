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

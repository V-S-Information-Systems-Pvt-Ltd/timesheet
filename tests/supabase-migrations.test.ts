// tests/supabase-migrations.test.ts
// Guards the contracted daily-totals RPC. The unscoped
// get_timesheet_daily_totals function (SECURITY DEFINER, every user's hours)
// was dropped by migration 20260917000000 after all callers moved to the
// scoped sumHoursForUserDates primitive. These tests pin the historical grant
// hardening AND the terminal drop, so no future migration may re-create or
// re-grant the function.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

describe('Supabase migration versions', () => {
  it('keeps one local file per timestamp version', () => {
    const versions = migrations.map((name) => name.split('_', 1)[0])
    expect(new Set(versions).size).toBe(versions.length)
  })
})

const mobileSessionMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('create table public.mobile_sessions'))

const rpcSql = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('get_timesheet_daily_totals'))

describe('get_timesheet_daily_totals grants', () => {
  it('has the defining migration and a restriction migration', () => {
    expect(rpcSql.some((m) => /create or replace function public\.get_timesheet_daily_totals/.test(m.sql))).toBe(true)
    expect(rpcSql.some((m) => /20260902000000/.test(m.name))).toBe(true)
  })

  it('never grants execution to public or anon', () => {
    for (const m of rpcSql) {
      expect(m.sql).not.toMatch(/grant execute on function public\.get_timesheet_daily_totals\(\) to (public|anon)/)
    }
  })

  it('the restriction migration limits execution to service_role only', () => {
    const restriction = rpcSql.find((m) => m.name === '20260902000000_restrict_totals_rpc.sql')
    expect(restriction).toBeDefined()
    expect(restriction!.sql).toMatch(/revoke all on function public\.get_timesheet_daily_totals\(\) from .*authenticated/)
    expect(restriction!.sql).toMatch(/grant execute on function public\.get_timesheet_daily_totals\(\) to service_role/)
  })

  it('the terminal migration drops the function and nothing re-creates it afterwards', () => {
    const drop = rpcSql.find((m) => /drop function if exists public\.get_timesheet_daily_totals/.test(m.sql))
    expect(drop).toBeDefined()
    const dropIdx = migrations.indexOf(drop!.name)
    for (const name of migrations.slice(dropIdx + 1)) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
      expect(sql).not.toMatch(/create (or replace )?function public\.get_timesheet_daily_totals/)
      expect(sql).not.toMatch(/grant execute on function public\.get_timesheet_daily_totals/)
    }
  })
})

// team_ids is SECURITY DEFINER and granted to authenticated. Its body must
// only answer for the caller's own subtree (target = auth.uid()); otherwise
// any signed-in user could enumerate arbitrary profiles' report trees via RPC,
// bypassing the profiles_select_* visibility policies.
const teamIdsMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => /create\s+(or\s+replace\s+)?function\s+public\.team_ids/i.test(m.sql))

describe('team_ids target guard', () => {
  it('has at least the defining migration and a guard migration', () => {
    expect(teamIdsMigrations.length).toBeGreaterThanOrEqual(2)
    expect(teamIdsMigrations.some((m) => /20260819000000/.test(m.name))).toBe(true)
  })

  it('the latest definition refuses targets other than the caller (auth.uid())', () => {
    const latest = teamIdsMigrations[teamIdsMigrations.length - 1]
    expect(latest.name).toBe('20260903000000_guard_team_ids_target.sql')
    // The body must gate the traversal on target = auth.uid()
    expect(latest.sql).toMatch(/when target = auth\.uid\(\)/)
    expect(latest.sql).toMatch(/else array\[\]::uuid\[\]/)
  })
})

describe('mobile sessions grants', () => {
  it('is server-only and cannot be queried through public PostgREST roles', () => {
    expect(mobileSessionMigrations).toHaveLength(1)
    const sql = mobileSessionMigrations[0].sql
    expect(sql).toMatch(/alter table public\.mobile_sessions enable row level security/i)
    expect(sql).toMatch(/revoke all on table public\.mobile_sessions from public, anon, authenticated/i)
  })
})

// bulk_update_timesheets is a SECURITY DEFINER write RPC that trusts its
// p_actor_id / p_can_edit_all arguments. It must never be callable by
// anon/authenticated (they could forge an actor id and edit arbitrary rows);
// only the service-role admin client may invoke it.
const bulkUpdateMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.bulk_update_timesheets'))

describe('bulk_update_timesheets security', () => {
  it('is defined in exactly one SECURITY DEFINER migration with a pinned search_path', () => {
    expect(bulkUpdateMigrations).toHaveLength(1)
    const sql = bulkUpdateMigrations[0].sql
    expect(sql).toMatch(/create or replace function public\.bulk_update_timesheets/)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path = public, pg_temp/i)
  })

  it('is granted to service_role only, never to public/anon/authenticated', () => {
    for (const m of bulkUpdateMigrations) {
      expect(m.sql).toMatch(
        /revoke all on function public\.bulk_update_timesheets\(uuid, boolean, jsonb\) from public, anon, authenticated/
      )
      expect(m.sql).toMatch(
        /grant execute on function public\.bulk_update_timesheets\(uuid, boolean, jsonb\) to service_role/
      )
      expect(m.sql).not.toMatch(
        /grant execute on function public\.bulk_update_timesheets\(uuid, boolean, jsonb\) to (public|anon|authenticated)/
      )
    }
  })
})

// Supabase-mode leaves/reminders are written by the browser straight through
// PostgREST; RLS checks ownership only. The text-length bounds the native
// REST routes enforce (leaveRowsSchema / reminderSchema) must therefore exist
// as database constraints, or any authenticated user can persist
// unbounded-length text into their own rows.
const boundTextMigration = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .find((m) => m.name === '20260905010000_bound_leave_reminder_text.sql')

describe('leaves/reminders text-length bounds', () => {
  it('bounds reason and message length at the database level', () => {
    expect(boundTextMigration).toBeDefined()
    expect(boundTextMigration!.sql).toMatch(
      /add constraint leaves_reason_max_len check \(char_length\(reason\) <= 500\) not valid/
    )
    expect(boundTextMigration!.sql).toMatch(
      /add constraint reminders_message_max_len check \(char_length\(message\) <= 500\) not valid/
    )
  })
})

// The own-row update policy must freeze every admin-managed column. A user
// who can rewrite their own manager_id via PostgREST evades their manager's
// team-scoped visibility and bypasses the action-layer self-change guard,
// cycle checks, and audit trail.
const ownUpdateMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('profiles_update_own_details'))

describe('profiles_update_own_details locked columns', () => {
  it('freezes the role axes and manager_id in the latest definition', () => {
    const latest = ownUpdateMigrations[ownUpdateMigrations.length - 1]
    expect(latest.name).toBe('20260905020000_freeze_manager_id_own_update.sql')
    for (const column of ['role', 'permission_role', 'hierarchy_role', 'is_active', 'manager_id']) {
      expect(latest.sql).toMatch(new RegExp(`${column} = \\(select ${column} from public\\.my_locked_profile_fields\\(\\)\\)`))
    }
  })
})

const reclassifyMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.reclassify_title_atomic'))

describe('reclassify_title_atomic security', () => {
  it('is defined as SECURITY DEFINER with search_path pinned to public, pg_temp', () => {
    expect(reclassifyMigrations).toHaveLength(1)
    const sql = reclassifyMigrations[0].sql
    expect(sql).toMatch(/create or replace function public\.reclassify_title_atomic/)
    expect(sql).toMatch(/p_hierarchy_role text/)
    expect(sql).toMatch(/p_hierarchy_role not in \('manager', 'team_lead', 'engineer', 'user'\)/)
    expect(sql).not.toMatch(/public\.hierarchy_role/)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path = public, pg_temp/i)
  })

  it('is granted to service_role only, revoked from public, anon, authenticated', () => {
    for (const m of reclassifyMigrations) {
      expect(m.sql).toMatch(
        /revoke all on function public\.reclassify_title_atomic\(text, text, boolean\) from public, anon, authenticated/
      )
      expect(m.sql).toMatch(
        /grant execute on function public\.reclassify_title_atomic\(text, text, boolean\) to service_role/
      )
    }
  })
})

// rotate_mobile_session is SECURITY DEFINER and the only server path that can
// mint replacement bearer tokens, so it must never be callable by public
// PostgREST roles. The forward migration was quarantined until a release owner
// approved the version-allocation process; that approval is recorded in
// docs/plans/SECURITY_REVIEW_REMEDIATION_NOTES.md and the pin now carries a
// fresh monotonic post-head identity (20260911000001) that applies exactly once
// regardless of what version 20260905000000 meant in any given environment.
const rotationMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.rotate_mobile_session('))

describe('rotate_mobile_session migration approval gate (P1)', () => {
  it('applies an approved post-head pin exactly once', () => {
    const pins = rotationMigrations.filter((m) => m.name.includes('20260911000001'))
    expect(pins).toHaveLength(1)
  })

  it('pins search_path to public, pg_temp and keeps grants service_role only', () => {
    const pin = rotationMigrations.find((m) => m.name.includes('20260911000001'))
    expect(pin).toBeDefined()
    expect(pin!.sql).toMatch(/create or replace function public\.rotate_mobile_session\(/)
    expect(pin!.sql).toMatch(/security definer/i)
    expect(pin!.sql).toMatch(/set search_path = public, pg_temp/i)
    expect(pin!.sql).toMatch(
      /revoke all on function public\.rotate_mobile_session\(text, text, timestamptz\)\s+from public, anon, authenticated/
    )
    expect(pin!.sql).toMatch(
      /grant execute on function public\.rotate_mobile_session\(text, text, timestamptz\)\s+to service_role/
    )
    expect(pin!.sql).not.toMatch(/grant execute on function public\.rotate_mobile_session\(text, text, timestamptz\) to (public|anon|authenticated)/)
  })

  it('revokes the whole family on replay of a rotated token', () => {
    const pin = rotationMigrations.find((m) => m.name.includes('20260911000001'))
    expect(pin).toBeDefined()
    // Two replay branches (found via previous_token_hash, and rotated_at set) must
    // both update the family scope.
    const familyUpdates = pin!.sql.match(/set revoked_at = coalesce\(s\.revoked_at, p_now\)/g)
    expect(familyUpdates).toHaveLength(2)
    expect(pin!.sql).toMatch(/where s\.family_id = current_session\.family_id and s\.revoked_at is null/)
  })
})

const rateLimitMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.reserve_rate_limit('))

describe('rate_limit RPC grants', () => {
  it('defines the reserve/release/cleanup functions in exactly one migration', () => {
    expect(rateLimitMigrations).toHaveLength(1)
    expect(rateLimitMigrations[0].name).toMatch(/^20260911000000/)
    const sql = rateLimitMigrations[0].sql
    expect(sql).toMatch(/create or replace function public\.reserve_rate_limit\(/)
    expect(sql).toMatch(/create or replace function public\.release_rate_limit\(/)
    expect(sql).toMatch(/create or replace function public\.cleanup_rate_limits\(/)
  })

  it('pins search_path and keeps every rate-limit RPC service_role only', () => {
    const sql = rateLimitMigrations[0].sql
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path = public, pg_temp/i)
    for (const fn of ['reserve_rate_limit', 'release_rate_limit', 'cleanup_rate_limits']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\b`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\b`))
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${fn}\\b.*to (public|anon|authenticated)`))
    }
  })

  it('revokes table access from every PostgREST role', () => {
    const sql = rateLimitMigrations[0].sql
    expect(sql).toMatch(/revoke all on table public\.rate_limits from public, anon, authenticated/)
    expect(sql).toMatch(/enable row level security/)
  })
})

const backfillMutationMigration = migrations
  .filter((name) => name.endsWith('_timesheets_backfill_window.sql'))
  .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }))[0]

describe('timesheet owner mutation backfill policies', () => {
  it('restricts owner update/delete policies to the configured writable window', () => {
    expect(backfillMutationMigration).toBeDefined()
    expect(backfillMutationMigration!.sql).toMatch(/create policy "timesheets_update_own"[\s\S]*auth\.uid\(\) = user_id/)
    expect(backfillMutationMigration!.sql).toMatch(/create policy "timesheets_delete_own"[\s\S]*auth\.uid\(\) = user_id/)
    expect(backfillMutationMigration!.sql).toMatch(/backfill_window_days/)
    expect(backfillMutationMigration!.sql).toMatch(/backfill_extra_days/)
    expect(backfillMutationMigration!.sql).toMatch(/log_date <= current_date/)
  })
})

const ensureSessionsMigrations = migrations
  .filter((name) => name.endsWith('_ensure_mobile_sessions.sql'))
  .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }))

describe('ensure_mobile_sessions bridge migration (CP2)', () => {
  it('exists exactly once and sorts between 20260905000000 and 20260905030000', () => {
    expect(ensureSessionsMigrations).toHaveLength(1)
    const bridge = ensureSessionsMigrations[0]
    expect(bridge.name).toBe('20260905000001_ensure_mobile_sessions.sql')
    expect(bridge.name > '20260905000000').toBe(true)
    expect(bridge.name < '20260905030000').toBe(true)
  })

  it('is completely idempotent and contains no rotate_mobile_session definition', () => {
    const bridge = ensureSessionsMigrations[0]
    expect(bridge.sql).toMatch(/create table if not exists public\.mobile_sessions/i)
    expect(bridge.sql).toMatch(/create index if not exists mobile_sessions_user_active_idx/i)
    expect(bridge.sql).toMatch(/create index if not exists mobile_sessions_family_idx/i)
    expect(bridge.sql).toMatch(/alter table public\.mobile_sessions enable row level security/i)
    expect(bridge.sql).toMatch(/revoke all on table public\.mobile_sessions from public, anon, authenticated/i)
    expect(bridge.sql).not.toMatch(/rotate_mobile_session/i)
  })
})

const restoreBackupMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.restore_backup_tx'))

describe('restore_backup_tx security', () => {
  it('is defined in exactly one SECURITY DEFINER migration with a pinned search_path', () => {
    expect(restoreBackupMigrations).toHaveLength(1)
    const sql = restoreBackupMigrations[0].sql
    expect(sql).toMatch(/create or replace function public\.restore_backup_tx/)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path = public, pg_temp/i)
  })

  it('is granted to service_role only, never to public/anon/authenticated', () => {
    for (const m of restoreBackupMigrations) {
      expect(m.sql).toMatch(
        /revoke all on function public\.restore_backup_tx\(jsonb\) from public, anon, authenticated/
      )
      expect(m.sql).toMatch(
        /grant execute on function public\.restore_backup_tx\(jsonb\) to service_role/
      )
      expect(m.sql).not.toMatch(
        /grant execute on function public\.restore_backup_tx\(jsonb\) to (public|anon|authenticated)/
      )
    }
  })
})

describe('execute_idempotent_mutation removal (T19.2/T22.1)', () => {
  it('no migration creates a raw-SQL mutation executor (domain owns all writes)', () => {
    for (const f of migrations) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
      expect(sql).not.toMatch(/create or replace function public\.execute_idempotent_mutation/i)
    }
  })

  it('the 20260915 migration explicitly drops the legacy executor if present', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, '20260915000000_idempotent_mutations.sql'), 'utf8')
    expect(sql).toMatch(/drop function if exists public\.execute_idempotent_mutation/i)
  })
})

describe('idempotency effects migration (T19.2)', () => {
  const effectMigration = '20260920000000_idempotency_effects.sql'

  it('records immutable actor- and operation-scoped effects in the business-write transaction', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, effectMigration), 'utf8')
    expect(sql).toMatch(/create table if not exists public\.idempotency_effects/i)
    expect(sql).toMatch(/primary key \(key, actor_id, operation\)/i)
    expect(sql).toMatch(/create index if not exists idx_idempotency_effects_created_at/i)
    expect(sql).toMatch(/current_setting\('request\.headers', true\)/i)
    expect(sql).toMatch(/txid_current\(\)/i)
    expect(sql).toMatch(/after insert or update or delete on public\.timesheets/i)
    expect(sql).toMatch(/after insert or delete on public\.leaves/i)
    expect(sql).toMatch(/after insert or update or delete on public\.reminders/i)
  })

  it('claims the key, performs the write, and commits the response in ONE statement transaction', () => {
    // Claim happens in BEFORE triggers, response commit in AFTER triggers of the
    // same business write — there is no separate claim/commit request.
    const sql = readFileSync(path.join(MIGRATIONS_DIR, effectMigration), 'utf8')
    expect(sql).toMatch(/before insert or update or delete on public\.timesheets/i)
    expect(sql).toMatch(/before insert or delete on public\.leaves/i)
    expect(sql).toMatch(/before insert or update or delete on public\.reminders/i)
    expect(sql).toMatch(/function private\.mobile_idempotency_claim\(\)/i)
    expect(sql).toMatch(/function private\.mobile_idempotency_commit\(\)/i)
    expect(sql).toMatch(/create trigger \w+_idempotency_claim\b/i)
    expect(sql).toMatch(/create trigger \w+_idempotency_commit\b/i)
    expect(sql).toMatch(/insert into public\.idempotency_effects[\s\S]*on conflict \(key, actor_id, operation\) do nothing/i)
    expect(sql).toMatch(/update public\.idempotency_effects\s+set response_status/i)
  })

  it('binds a server-derived effect fingerprint computed from the row, never from caller headers', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, effectMigration), 'utf8')
    expect(sql).toMatch(/effect_fingerprint text not null default ''/i)
    expect(sql).toMatch(/resource_id text/i)
    expect(sql).toMatch(/sha256\(convert_to\(/i)
    expect(sql).toMatch(/jsonb_build_object\(/i)
    // Fingerprint/response identity is server-derived; headers are only the
    // routing key/operation.
    expect(sql).toMatch(/raise exception 'IDEMPOTENCY_CONFLICT:[\s\S]*using errcode = 'P0001'/i)
    expect(sql).not.toMatch(/payload_fingerprint/) // no client-supplied fingerprint anywhere
  })

  it('keeps effect writes private and allows only an actor to read their own evidence', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, effectMigration), 'utf8')
    expect(sql).toMatch(/alter table public\.idempotency_effects enable row level security/i)
    expect(sql).toMatch(/revoke all on table public\.idempotency_effects from public, anon, authenticated/i)
    expect(sql).toMatch(/grant select on table public\.idempotency_effects to authenticated/i)
    expect(sql).toMatch(/using \(\(select auth\.uid\(\)\) = actor_id\)/i)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path = ''/i)
    expect(sql).toMatch(/revoke all on function private\.mobile_idempotency_claim\(\) from public, anon, authenticated/i)
    expect(sql).toMatch(/revoke all on function private\.mobile_idempotency_commit\(\) from public, anon, authenticated/i)
  })
})

describe('idempotency effects hardening + fingerprint/RPC (T19.2 remediation)', () => {
  // The three original successor migrations were consolidated into the single
  // never-applied base file to avoid an intermediate fingerprint format (see
  // header comment): evidence created between partial applies must never exist
  // in a format the canonical fingerprint function cannot interpret.
  const consolidated = '20260920000000_idempotency_effects.sql'

  it('remains one consolidated migration with no superseded successors on disk', () => {
    const files = readdirSync(MIGRATIONS_DIR)
    expect(files).toContain(consolidated)
    expect(files).not.toContain('20260921000000_idempotency_effects_hardening.sql')
    expect(files).not.toContain('20260922000000_idempotency_effect_fingerprint_and_rpc.sql')
  })

  it('grants service_role the least privilege, indexes actor_id, and empties the definer search path', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, consolidated), 'utf8')
    expect(sql).toMatch(/grant select, delete on table public\.idempotency_effects to service_role/i)
    expect(sql).toMatch(/create index if not exists idx_idempotency_effects_actor_id/i)
    const emptyPathMatches = sql.match(/set search_path = ''/g)
    expect(emptyPathMatches?.length).toBeGreaterThanOrEqual(4)
  })

  it('defines one canonical fingerprint function used by triggers and the RPC', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, consolidated), 'utf8')
    expect(sql).toMatch(/function public\.idempotency_effect_fingerprint\(p_operation text, p_payload jsonb\)/i)
    expect(sql).toMatch(/immutable/i)
    expect(sql).toMatch(/sha256\(convert_to\(/i)
    expect(sql).toMatch(/function private\.claim_idempotency_effect\(/i)
    expect(sql).toMatch(/function private\.commit_idempotency_effect\(/i)
    expect(sql).toMatch(/perform private\.claim_idempotency_effect\(/i)
    expect(sql).toMatch(/public\.idempotency_effect_fingerprint\(effect_operation, payload\)/i)
    // hours_worked is numeric(4,2) in production: canonicalize with a fixed
    // scale-2 round so fractional hours (1.5) and DB-formatted values (4.00)
    // neither raise 22P02 nor disagree between the row and the request.
    const hoursMatches = sql.match(/round\(\(p_payload ->> 'hours_worked'\)::numeric, 2\)/g)
    expect(hoursMatches?.length).toBeGreaterThanOrEqual(2)
    // The SECURITY INVOKER RPC resolves the private claim/commit helpers as
    // authenticated, so schema USAGE must be granted (EXECUTE alone is not
    // enough to call into a schema the role cannot see).
    expect(sql).toMatch(/grant usage on schema private to authenticated/i)
  })

  it('only allows the RPC to re-enter a same-transaction claim, and keeps private execution default-off', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, consolidated), 'utf8')
    // Explicit re-entry signalling + validation (P2): unrelated same-transaction
    // claims (e.g. a direct multi-row Data API write) must be rejected.
    expect(sql).toMatch(/set_config\(\s*'vsis\.idempotency_reentry'/i)
    expect(sql).toMatch(/current_setting\('vsis\.idempotency_reentry', true\)/i)
    expect(sql).toMatch(/jsonb_build_object\('key', p_key, 'operation', 'create_leave', 'fingerprint', fingerprint\)/i)
    expect(sql).toMatch(/\(reentry ->> 'key'\) is distinct from p_key/i)
    expect(sql).toMatch(/\(reentry ->> 'fingerprint'\) is not distinct from eff_fp/i)
    // Belt-and-suspenders: no private function has default PUBLIC EXECUTE (P3).
    expect(sql).toMatch(/revoke execute on all functions in schema private from public, anon/i)
  })

  it('opens and commits an explicit transaction for migration-runner portability', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, consolidated), 'utf8')
    expect(sql).toMatch(/\bbegin;[\s\S]*\bcommit;\s*$/i)
  })

  it('exposes an atomic SECURITY INVOKER create_leave RPC that fingerprints the whole batch', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, consolidated), 'utf8')
    expect(sql).toMatch(/function public\.create_leaves_idempotent\(p_key text, p_rows jsonb\)/i)
    expect(sql).toMatch(/security invoker/i)
    expect(sql).toMatch(/idempotency_effect_fingerprint\('create_leave', p_rows\)/i)
    expect(sql).toMatch(/insert into public\.leaves \(user_id, leave_date, reason\)/i)
    expect(sql).toMatch(/revoke all on function public\.create_leaves_idempotent\(text, jsonb\) from public, anon/i)
    expect(sql).toMatch(/grant execute on function public\.create_leaves_idempotent\(text, jsonb\) to authenticated/i)
    // No client-supplied fingerprint anywhere in the remediation.
    expect(sql).not.toMatch(/payload_fingerprint/)
  })
})

describe('idempotency trigger nullif follow-up (T19.2)', () => {
  // Applied migrations are never edited: hardening the already-pushed
  // 20260920000000 trigger bodies ships as a new file with CREATE OR REPLACE.
  const followUp = '20260923000000_idempotency_trigger_nullif_headers.sql'

  it('exists and only replaces the two trigger functions', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, followUp), 'utf8')
    expect(sql).toMatch(/create or replace function private\.mobile_idempotency_claim\(\)/i)
    expect(sql).toMatch(/create or replace function private\.mobile_idempotency_commit\(\)/i)
    expect(sql).not.toMatch(/create table/i)
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).not.toMatch(/^\s*grant /im)
    expect(sql).not.toMatch(/execute_idempotent_mutation/i)
  })

  it('strips an empty request.headers GUC before JSON parsing in both triggers', () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, followUp), 'utf8')
    const hardened = sql.match(/coalesce\(nullif\(current_setting\('request\.headers', true\), ''\), '\{\}'\)::jsonb/g)
    expect(hardened?.length).toBe(2)
    // The hardened file must not reintroduce the crashing form.
    expect(sql).not.toMatch(/coalesce\(current_setting\('request\.headers', true\), '\{\}'\)::jsonb/)
  })
})

// tests/supabase-migrations.test.ts
// Guards the grant surface of the timesheet daily-totals RPC. The function is
// SECURITY DEFINER and returns every user's hours, so it must never be callable
// by anon/authenticated clients. Regression test for the Phase 4.3 fix — if a
// future migration re-grants it, this fails.
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
  it('has at least the defining migration and a restriction migration', () => {
    expect(rpcSql.length).toBeGreaterThanOrEqual(2)
    expect(rpcSql.some((m) => /create or replace function public\.get_timesheet_daily_totals/.test(m.sql))).toBe(true)
    expect(rpcSql.some((m) => /20260902000000/.test(m.name))).toBe(true)
  })

  it('never grants execution to public or anon', () => {
    for (const m of rpcSql) {
      expect(m.sql).not.toMatch(/grant execute on function public\.get_timesheet_daily_totals\(\) to (public|anon)/)
    }
  })

  it('the latest migration restricts execution to service_role only', () => {
    const latest = rpcSql[rpcSql.length - 1]
    expect(latest.name).toBe('20260902000000_restrict_totals_rpc.sql')
    expect(latest.sql).toMatch(/revoke all on function public\.get_timesheet_daily_totals\(\) from .*authenticated/)
    expect(latest.sql).toMatch(/grant execute on function public\.get_timesheet_daily_totals\(\) to service_role/)
  })
})

// team_ids is SECURITY DEFINER and granted to authenticated. Its body must
// only answer for the caller's own subtree (target = auth.uid()); otherwise
// any signed-in user could enumerate arbitrary profiles' report trees via RPC,
// bypassing the profiles_select_* visibility policies.
const teamIdsMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.team_ids'))

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

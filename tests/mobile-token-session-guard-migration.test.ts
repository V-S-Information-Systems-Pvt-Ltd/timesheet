import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations')
const migrationName = '20260926000000_mobile_token_session_guard.sql'
const migrationPath = path.join(migrationsDir, migrationName)
const sql = readFileSync(migrationPath, 'utf8')
const hardeningMigrationName = '20260927000000_harden_security_definer_ownership_and_mobile_guard.sql'
const hardeningSql = readFileSync(path.join(migrationsDir, hardeningMigrationName), 'utf8')

describe('mobile Supabase token session guard migration', () => {
  it('is additive and follows the existing migration head', () => {
    const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
    const index = migrations.indexOf(migrationName)

    expect(index).toBeGreaterThan(0)
    expect(migrationName.localeCompare('20260925000000_password_change_bounded_guard_and_revoke_all.sql')).toBeGreaterThan(0)
    expect(hardeningMigrationName.localeCompare(migrationName)).toBeGreaterThan(0)
  })

  it('keeps sid-less browser JWTs unchanged and validates signed mobile sid sessions', () => {
    expect(sql).toMatch(/sid_claim text := auth\.jwt\(\) ->> 'sid'/i)
    expect(sql).toMatch(/if sid_claim is null or btrim\(sid_claim\) = '' then\s+return true;/i)
    expect(sql).toMatch(/s\.id = session_id/i)
    expect(sql).toMatch(/s\.user_id = caller_id/i)
    expect(sql).toMatch(/s\.revoked_at is null/i)
    expect(sql).toMatch(/s\.rotated_at is null/i)
    expect(sql).toMatch(/s\.idle_expires_at > pg_catalog\.now\(\)/i)
    expect(sql).toMatch(/s\.absolute_expires_at > pg_catalog\.now\(\)/i)
    expect(sql).toMatch(/join public\.profiles as p on p\.id = s\.user_id/i)
    expect(sql).toMatch(/and p\.is_active/i)
  })

  it('uses a locked-down SECURITY DEFINER helper with only policy-required execute access', () => {
    expect(sql).toMatch(/create or replace function public\.mobile_token_session_is_valid\(\)/i)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path = pg_catalog, pg_temp/i)
    expect(sql).toMatch(/revoke all on function public\.mobile_token_session_is_valid\(\)\s+from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.mobile_token_session_is_valid\(\)\s+to authenticated/i)
    expect(sql).not.toMatch(/grant execute on function public\.mobile_token_session_is_valid\(\)\s+to (public|anon)/i)
  })

  it('guards authenticated SECURITY DEFINER helper RPCs against revoked mobile tokens', () => {
    for (const signature of ['has_role\(role_name text\)', 'my_locked_profile_fields\(\)']) {
      const escaped = signature.replace(/[()]/g, '\\$&')
      const definition = new RegExp(
        `create or replace function public\\.${escaped}[\\s\\S]+?\\$\\$;`,
        'i'
      )
      const match = sql.match(definition)

      expect(match?.[0]).toMatch(/security definer/i)
      expect(match?.[0]).toMatch(/set search_path = pg_catalog, pg_temp/i)
      expect(match?.[0]).toMatch(/public\.mobile_token_session_is_valid\(\)/i)
    }

    expect(sql).toMatch(/revoke all on function public\.has_role\(text\) from public, anon/i)
    expect(sql).toMatch(/revoke all on function public\.my_locked_profile_fields\(\) from public, anon/i)
  })

  it('forward-hardens team_ids without rewriting the applied session-guard migration', () => {
    expect(sql).not.toMatch(/create or replace function public\.team_ids\(target uuid\)/i)
    expect(hardeningSql).toMatch(/create or replace function public\.team_ids\(target uuid\)/i)
    expect(hardeningSql).toMatch(/security definer/i)
    expect(hardeningSql).toMatch(/set search_path = pg_catalog, pg_temp/i)
    expect(hardeningSql).toMatch(/public\.mobile_token_session_is_valid\(\) and target = auth\.uid\(\)/i)
    expect(hardeningSql).toMatch(/else array\[\]::uuid\[\]/i)
    expect(hardeningSql).toMatch(/revoke all on function public\.team_ids\(uuid\) from public, anon, authenticated/i)
    expect(hardeningSql).toMatch(/grant execute on function public\.team_ids\(uuid\) to authenticated/i)
  })

  it('dynamically installs a restrictive guard on every existing public RLS table', () => {
    expect(sql).toMatch(/from pg_catalog\.pg_class as c/i)
    expect(sql).toMatch(/join pg_catalog\.pg_namespace as n on n\.oid = c\.relnamespace/i)
    expect(sql).toMatch(/n\.nspname = 'public'/i)
    expect(sql).toMatch(/c\.relkind in \('r', 'p'\)/i)
    expect(sql).toMatch(/c\.relrowsecurity/i)
    expect(sql).toMatch(/create policy %I on %I\.%I as restrictive for all to authenticated/i)
    expect(sql).toMatch(/using \(public\.mobile_token_session_is_valid\(\)\) with check \(public\.mobile_token_session_is_valid\(\)\)/i)
  })

  it('moves the row-independent session check behind a scalar subquery in a forward migration', () => {
    expect(hardeningSql).toMatch(/from pg_catalog\.pg_policy as p/i)
    expect(hardeningSql).toMatch(/p\.polname = 'mobile_token_session_guard'/i)
    expect(hardeningSql).toMatch(/alter policy %I on %I\.%I using \(\(select public\.mobile_token_session_is_valid\(\)\)\) with check \(\(select public\.mobile_token_session_is_valid\(\)\)\)/i)
    expect(hardeningSql).toMatch(/create policy %I on %I\.%I as restrictive for all to authenticated using \(\(select public\.mobile_token_session_is_valid\(\)\)\) with check \(\(select public\.mobile_token_session_is_valid\(\)\)\)/i)
  })

  it('runs after every migration that enables RLS on a public table', () => {
    const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
    const guardIndex = migrations.indexOf(hardeningMigrationName)
    const laterRlsEnablers = migrations.slice(guardIndex + 1).filter((name) => {
      const laterSql = readFileSync(path.join(migrationsDir, name), 'utf8')
      return /alter table public\.[a-z0-9_]+ enable row level security/i.test(laterSql)
    })

    expect(laterRlsEnablers).toEqual([])
  })
})

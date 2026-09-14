// tests/supabase-live-rls.int.test.ts
//
// Live Supabase / PostgreSQL RLS and RPC security verification test suite.
// Verifies live Row-Level Security policies, tenant isolation, SECURITY INVOKER
// behavior, and service-role RPC boundaries against a real PostgreSQL instance.
//
// Runs when TEST_DATABASE_URL is set (skipped otherwise with explicit reporting).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { createClient } from '@supabase/supabase-js'

interface TimesheetRow {
  id: string
  user_id: string
}

interface GroupedTotalRow {
  label: string
  hours: number
  entries: number
}

interface RlsUserSpec {
  email: string
  name: string
  role: 'admin' | 'user'
  permission_role: 'admin' | 'user'
  hierarchy_role: 'manager' | 'user'
  managerEmail: string | null
  isActive: boolean
}

const RLS_USERS: RlsUserSpec[] = [
  { email: 'rls.admin@example.com', name: 'Admin User', role: 'admin', permission_role: 'admin', hierarchy_role: 'manager', managerEmail: null, isActive: true },
  { email: 'rls.manager@example.com', name: 'Manager User', role: 'user', permission_role: 'user', hierarchy_role: 'manager', managerEmail: null, isActive: true },
  { email: 'rls.user.a@example.com', name: 'User A', role: 'user', permission_role: 'user', hierarchy_role: 'user', managerEmail: 'rls.manager@example.com', isActive: true },
  { email: 'rls.user.b@example.com', name: 'User B', role: 'user', permission_role: 'user', hierarchy_role: 'user', managerEmail: null, isActive: true },
  { email: 'rls.inactive@example.com', name: 'Inactive User', role: 'user', permission_role: 'user', hierarchy_role: 'user', managerEmail: null, isActive: false },
]

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const canUseSupabaseAdminApi = Boolean(supabaseUrl && supabaseServiceRoleKey)

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite('Supabase live RLS and RPC security policies (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })

  let adminId: string
  let managerId: string
  let userAId: string
  let userBId: string
  let inactiveId: string
  let projectId: string
  let activityTypeId: string
  const createdAuthUserIds: string[] = []

  /**
   * Create (or reuse) the GoTrue identity backing a profile.
   *
   * public.profiles.id is a required foreign key to auth.users(id) with no
   * default, so every fixture needs a real Auth identity first. Uses the
   * Supabase Admin API when service credentials are available (same pattern as
   * scripts/seed-supabase-matrix.mjs) and falls back to a direct auth.users
   * insert for database-only targets.
   */
  async function ensureAuthUserId(email: string): Promise<string> {
    if (canUseSupabaseAdminApi) {
      const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (listErr) {
        throw new Error(`Failed to list auth users for RLS fixtures: ${listErr.message}`)
      }
      const existing = (listed?.users || []).find((u) => u.email?.toLowerCase() === email)
      if (existing) return existing.id
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: 'rls-fixture-password-1!',
        email_confirm: true,
      })
      if (error || !data.user) {
        throw new Error(`Failed to create auth user ${email}: ${error?.message ?? 'unknown error'}`)
      }
      return data.user.id
    }

    const res = await pool.query<{ id: string }>(
      `insert into auth.users (email, encrypted_password, email_confirmed_at, created_at, updated_at)
       values ($1, '', now(), now(), now())
       on conflict (email) do update set updated_at = now()
       returning id`,
      [email]
    )
    return res.rows[0].id
  }

  async function asIdentity<T>(
    identity: { id?: string; role?: 'anon' | 'authenticated' },
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query('begin')
      const role = identity.role ?? (identity.id ? 'authenticated' : 'anon')
      await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [role])
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [identity.id ?? ''])
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: identity.id ?? null, role }),
      ])
      try {
        await client.query(`set local role ${role}`)
      } catch {
        // standalone postgres fallback
      }
      const res = await fn(client)
      await client.query('rollback')
      return res
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  }

  beforeAll(async () => {
    // 0. Verify required Supabase security infrastructure exists (fail if missing)
    const checkRoles = await pool.query<{ count: string }>(`
      select count(*)::text as count from pg_roles where rolname in ('anon', 'authenticated')
    `)
    if (parseInt(checkRoles.rows[0]?.count || '0', 10) < 2) {
      throw new Error(
        'Required roles "anon" and "authenticated" are missing. Ensure the local Supabase stack has initialized.'
      )
    }

    const checkHelpers = await pool.query<{ uid_exists: boolean; role_exists: boolean }>(`
      select
        to_regproc('auth.uid') is not null as uid_exists,
        to_regproc('auth.role') is not null as role_exists
    `)
    if (!checkHelpers.rows[0]?.uid_exists || !checkHelpers.rows[0]?.role_exists) {
      throw new Error(
        'Required Supabase security helpers auth.uid() or auth.role() are missing. Ensure the local Supabase stack has initialized.'
      )
    }

    const checkRpc = await pool.query<{ rpc_exists: boolean }>(`
      select to_regproc('public.get_grouped_report_totals') is not null as rpc_exists
    `)
    if (!checkRpc.rows[0]?.rpc_exists) {
      throw new Error(
        'Required RPC public.get_grouped_report_totals is missing. Ensure Supabase migrations have been applied.'
      )
    }

    // 1. Create test project and activity type
    const pRes = await pool.query<{ id: string }>(
      `insert into public.projects (name, so_number, telegram_no)
       values ('RLS-Test-Project', 'RLS-01', 9999)
       on conflict (name) do update set so_number = excluded.so_number
       returning id`
    )
    projectId = pRes.rows[0].id

    const aRes = await pool.query<{ id: string }>(
      `insert into public.activity_types (name, is_active)
       values ('RLS-Test-Activity', true)
       on conflict (name) do update set is_active = true
       returning id`
    )
    activityTypeId = aRes.rows[0].id

    // 2. Create identities (admin, manager, userA, userB, inactive): each
    // profile requires a real auth.users row, so provision GoTrue identities
    // first and upsert profiles keyed by that id.
    const authIds = new Map<string, string>()
    for (const spec of RLS_USERS) {
      authIds.set(spec.email, await ensureAuthUserId(spec.email))
    }
    createdAuthUserIds.push(...authIds.values())

    const upsertProfile = async (spec: RlsUserSpec): Promise<string> => {
      const id = authIds.get(spec.email)!
      const res = await pool.query<{ id: string }>(
        `insert into public.profiles (id, email, name, role, permission_role, hierarchy_role, is_active)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           email = excluded.email,
           name = excluded.name,
           permission_role = excluded.permission_role,
           hierarchy_role = excluded.hierarchy_role,
           role = excluded.permission_role,
           is_active = excluded.is_active
         returning id`,
        [id, spec.email, spec.name, spec.permission_role, spec.permission_role, spec.hierarchy_role, spec.isActive]
      )
      return res.rows[0].id
    }

    adminId = await upsertProfile(RLS_USERS[0])
    managerId = await upsertProfile(RLS_USERS[1])
    userAId = await upsertProfile(RLS_USERS[2])
    userBId = await upsertProfile(RLS_USERS[3])
    inactiveId = await upsertProfile(RLS_USERS[4])

    // Link userA to the manager after both profiles exist.
    await pool.query(`update public.profiles set manager_id = $1 where id = $2`, [managerId, userAId])

    // 3. Insert initial timesheets for userA and userB
    await pool.query(
      `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
       values ($1, $2, $3, '2026-01-01', 5, 'User A work'),
              ($4, $2, $3, '2026-01-01', 7, 'User B work')`,
      [userAId, projectId, activityTypeId, userBId]
    )
  })

  afterAll(async () => {
    const allUserIds = [adminId, managerId, userAId, userBId, inactiveId].filter(Boolean)
    if (allUserIds.length > 0) {
      await pool.query(`delete from public.timesheets where user_id = any($1::uuid[])`, [allUserIds])
      await pool.query(`delete from public.profiles where id = any($1::uuid[])`, [allUserIds])
    }
    if (projectId) {
      await pool.query(`delete from public.projects where id = $1`, [projectId])
    }
    if (activityTypeId) {
      await pool.query(`delete from public.activity_types where id = $1`, [activityTypeId])
    }

    // Remove the provisioned GoTrue identities so repeat runs stay clean.
    for (const authId of createdAuthUserIds) {
      try {
        if (canUseSupabaseAdminApi) {
          const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
          await admin.auth.admin.deleteUser(authId)
        } else {
          // Dependent rows first; guard each statement so older schemas
          // without a given auth table do not fail the cleanup.
          for (const sql of [
            `delete from auth.refresh_tokens where user_id = $1`,
            `delete from auth.sessions where user_id = $1`,
            `delete from auth.identities where user_id = $1`,
            `delete from auth.users where id = $1`,
          ]) {
            await pool.query(sql, [authId]).catch(() => {})
          }
        }
      } catch (err) {
        console.warn(`Warning: failed to clean up auth user ${authId}:`, err instanceof Error ? err.message : err)
      }
    }

    await pool.end()
  })

  it('verifies RLS is enabled on public.timesheets', async () => {
    const res = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'timesheets'`
    )
    expect(res.rows[0]?.relrowsecurity).toBe(true)
  })

  it('verifies RLS is enabled on public.whitelisted_domains', async () => {
    const res = await pool.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'whitelisted_domains'`
    )
    expect(res.rows[0]?.relrowsecurity).toBe(true)
  })

  it('verifies get_timesheet_daily_totals does NOT exist in live schema (dropped in favor of scoped RPCs)', async () => {
    const res = await pool.query(
      `select routine_name
       from information_schema.routines
       where routine_schema = 'public' and routine_name = 'get_timesheet_daily_totals'`
    )
    expect(res.rows.length).toBe(0)
  })

  it('verifies rate_limits table does not grant select or insert to anon or public', async () => {
    const res = await pool.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'rate_limits'
         and grantee in ('anon', 'public')`
    )
    expect(res.rows.length).toBe(0)
  })

  it('enforces anonymous identity: denies select and mutation', async () => {
    await asIdentity({ role: 'anon' }, async (client) => {
      const res = await client.query(`select * from public.timesheets`)
      expect(res.rows.length).toBe(0)

      await expect(
        client.query(
          `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
           values ($1, $2, $3, '2026-01-02', 4, 'Anon attempt')`,
          [userAId, projectId, activityTypeId]
        )
      ).rejects.toThrow()
    })
  })

  it('enforces regular user identity: tenant isolation, self-mutations allowed, cross-tenant denied', async () => {
    await asIdentity({ id: userAId }, async (client) => {
      // 1. Visibility isolation: userA sees only their own entry
      const rows = (await client.query(`select id, user_id, hours_worked from public.timesheets`)).rows
      expect(rows).toHaveLength(1)
      expect(rows[0].user_id).toBe(userAId)
      expect(rows[0].hours_worked).toBe(5)

      // 2. Mutation allowed: own entry
      const insertRes = await client.query(
        `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
         values ($1, $2, $3, '2026-01-02', 4, 'User A own entry')
         returning id`,
        [userAId, projectId, activityTypeId]
      )
      expect(insertRes.rows).toHaveLength(1)

      // 3. Mutation denied: inserting for userB (wrapped in a savepoint to prevent transaction abort)
      await client.query('savepoint rls_insert_denial')
      try {
        await expect(
          client.query(
            `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
             values ($1, $2, $3, '2026-01-02', 4, 'Spoofed user B entry')`,
            [userBId, projectId, activityTypeId]
          )
        ).rejects.toThrow(/violates row-level security policy/)
      } finally {
        await client.query('rollback to savepoint rls_insert_denial')
      }

      // 4. Update cross-user denied: 0 rows affected
      const updateRes = await client.query(
        `update public.timesheets set work_done = 'tampered' where user_id = $1`,
        [userBId]
      )
      expect(updateRes.rowCount).toBe(0)

      // 5. Delete cross-user denied: 0 rows affected
      const deleteRes = await client.query(
        `delete from public.timesheets where user_id = $1`,
        [userBId]
      )
      expect(deleteRes.rowCount).toBe(0)
    })
  })

  it('enforces manager identity: sees subordinates in reporting hierarchy, but not unrelated users', async () => {
    await asIdentity({ id: managerId }, async (client) => {
      const rows = (await client.query<TimesheetRow>(`select id, user_id from public.timesheets`)).rows
      // userA reports to manager -> visible
      expect(rows.some((r) => r.user_id === userAId)).toBe(true)
      // userB does NOT report to manager -> invisible
      expect(rows.some((r) => r.user_id === userBId)).toBe(false)
    })
  })

  it('enforces administrator identity: full visibility and privileged insertion', async () => {
    await asIdentity({ id: adminId }, async (client) => {
      const rows = (await client.query<TimesheetRow>(`select id, user_id from public.timesheets`)).rows
      // Admin sees both users
      expect(rows.some((r) => r.user_id === userAId)).toBe(true)
      expect(rows.some((r) => r.user_id === userBId)).toBe(true)

      // Admin backfill insertion for userB is allowed
      const insertRes = await client.query(
        `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
         values ($1, $2, $3, '2026-01-03', 2, 'Admin backfilled entry')
         returning id`,
        [userBId, projectId, activityTypeId]
      )
      expect(insertRes.rows).toHaveLength(1)
    })
  })

  it('enforces inactive user identity: mutations rejected by policy', async () => {
    await asIdentity({ id: inactiveId }, async (client) => {
      await expect(
        client.query(
          `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
           values ($1, $2, $3, '2026-01-02', 1, 'Inactive attempt')`,
          [inactiveId, projectId, activityTypeId]
        )
      ).rejects.toThrow(/violates row-level security policy/)
    })
  })

  it('verifies get_grouped_report_totals RPC executes under SECURITY INVOKER with caller RLS scoping', async () => {
    // 1. Regular userA calls RPC: aggregates only their own 5 hours
    await asIdentity({ id: userAId }, async (client) => {
      const res = await client.query<GroupedTotalRow>(
        `select label, hours, entries from public.get_grouped_report_totals('user')`
      )
      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].label).toBe('rls.user.a@example.com')
      expect(Number(res.rows[0].hours)).toBe(5)
    })

    // 2. Admin calls RPC: aggregates across both users (userA 5h + userB 7h)
    await asIdentity({ id: adminId }, async (client) => {
      const res = await client.query<GroupedTotalRow>(
        `select label, hours, entries from public.get_grouped_report_totals('user')`
      )
      expect(res.rows.length).toBeGreaterThanOrEqual(2)
      const userARow = res.rows.find((r) => r.label === 'rls.user.a@example.com')
      const userBRow = res.rows.find((r) => r.label === 'rls.user.b@example.com')
      expect(Number(userARow?.hours)).toBe(5)
      expect(Number(userBRow?.hours)).toBe(7)
    })

    // 3. Anon calling RPC: denied by grant
    await asIdentity({ role: 'anon' }, async (client) => {
      await expect(
        client.query(`select * from public.get_grouped_report_totals('user')`)
      ).rejects.toThrow(/permission denied/)
    })
  })
})

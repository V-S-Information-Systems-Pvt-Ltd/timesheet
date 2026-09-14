// tests/supabase-live-rls.int.test.ts
//
// Live Supabase / PostgreSQL RLS and RPC security verification test suite.
// Verifies live Row-Level Security policies, tenant isolation, SECURITY INVOKER
// behavior, and service-role RPC boundaries against a real PostgreSQL instance.
//
// Runs when TEST_DATABASE_URL is set (skipped otherwise with explicit reporting).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

interface TimesheetRow {
  id: string
  user_id: string
}

interface GroupedTotalRow {
  label: string
  hours: number
  entries: number
}

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

    // 2. Create identities: admin, manager, userA (reports to manager), userB (unrelated), inactive
    const adminRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
       values ('rls.admin@example.com', 'Admin User', 'admin', 'admin', 'manager', true)
       on conflict (email) do update set permission_role = 'admin', is_active = true
       returning id`
    )
    adminId = adminRes.rows[0].id

    const mgrRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
       values ('rls.manager@example.com', 'Manager User', 'user', 'user', 'manager', true)
       on conflict (email) do update set hierarchy_role = 'manager', is_active = true
       returning id`
    )
    managerId = mgrRes.rows[0].id

    const uARes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, manager_id, is_active)
       values ('rls.user.a@example.com', 'User A', 'user', 'user', 'user', $1, true)
       on conflict (email) do update set manager_id = $1, is_active = true
       returning id`,
      [managerId]
    )
    userAId = uARes.rows[0].id

    const uBRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, manager_id, is_active)
       values ('rls.user.b@example.com', 'User B', 'user', 'user', 'user', null, true)
       on conflict (email) do update set manager_id = null, is_active = true
       returning id`
    )
    userBId = uBRes.rows[0].id

    const inactRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
       values ('rls.inactive@example.com', 'Inactive User', 'user', 'user', 'user', false)
       on conflict (email) do update set is_active = false
       returning id`
    )
    inactiveId = inactRes.rows[0].id

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

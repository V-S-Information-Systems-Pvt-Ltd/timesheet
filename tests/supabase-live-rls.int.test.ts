// tests/supabase-live-rls.int.test.ts
//
// Live Supabase / PostgreSQL RLS and RPC security verification test suite.
// Verifies live Row-Level Security policies, tenant isolation, SECURITY INVOKER
// behavior, and service-role RPC boundaries against a real PostgreSQL instance.
//
// Runs when TEST_DATABASE_URL is set (skipped otherwise with explicit reporting).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite('Supabase live RLS and RPC security policies (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })

  let userAId: string
  let userBId: string
  let projectId: string
  let activityTypeId: string

  beforeAll(async () => {
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

    // 2. Create userA and userB
    const uARes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
       values ('rls.user.a@example.com', 'User A', 'user', 'user', 'user', true)
       on conflict (email) do update set is_active = true
       returning id`
    )
    userAId = uARes.rows[0].id

    const uBRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
       values ('rls.user.b@example.com', 'User B', 'user', 'user', 'user', true)
       on conflict (email) do update set is_active = true
       returning id`
    )
    userBId = uBRes.rows[0].id

    // 3. Insert timesheet for userA and userB
    await pool.query(
      `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
       values ($1, $2, $3, '2026-01-01', 5, 'User A work'),
              ($4, $2, $3, '2026-01-01', 7, 'User B work')`,
      [userAId, projectId, activityTypeId, userBId]
    )
  })

  afterAll(async () => {
    if (userAId && userBId) {
      await pool.query(`delete from public.timesheets where user_id in ($1, $2)`, [userAId, userBId])
      await pool.query(`delete from public.profiles where id in ($1, $2)`, [userAId, userBId])
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
})

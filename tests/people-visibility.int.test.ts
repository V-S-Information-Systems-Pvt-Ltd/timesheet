// tests/people-visibility.int.test.ts
// Live PostgreSQL regression for visibleUserClause with an unqualified `id`
// column (listProfiles / listOrgTree): test users stay hidden from
// non-super admins, and the admin department scope still filters.
// Runs only when TEST_DATABASE_URL is set.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { nativePeoplePersistence } from '@/lib/db/native/people'
import type { Actor } from '@/lib/db/types'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

const SUPER = 'vis.super@example.com'

function actorFor(id: string, email: string, permission_role: Actor['permission_role'], scope_departments: string[] | null = null): Actor {
  return { id, email, role: permission_role, permission_role, hierarchy_role: 'user', isActive: true, scope_departments }
}

suite('visibleUserClause on people lists (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })
  const ids: Record<string, string> = {}
  const prevSuper = process.env.SUPER_ADMIN_EMAIL

  beforeAll(async () => {
    if (url) process.env.DATABASE_URL = url
    process.env.SUPER_ADMIN_EMAIL = SUPER
    const mk = async (key: string, role: string, department: string, isTest = false) => {
      const r = await pool.query<{ id: string }>(
        `insert into public.profiles (email, name, role, department, is_active, is_test_user)
         values ($1, $1, $2, $3, true, $4)
         on conflict (email) do update set department = excluded.department, is_test_user = excluded.is_test_user, is_active = true
         returning id`,
        [`vis.${key}@example.com`, role, department, isTest]
      )
      ids[key] = r.rows[0].id
    }
    await mk('super', 'admin', 'VisA')
    await mk('admin', 'admin', 'VisA')
    await mk('tester', 'user', 'VisA', true)
    await mk('ina', 'user', 'VisA')
    await mk('inb', 'user', 'VisB')
  })

  afterAll(async () => {
    process.env.SUPER_ADMIN_EMAIL = prevSuper
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [Object.values(ids)])
    await pool.end()
  })

  const listed = async (actor: Actor) => new Set((await nativePeoplePersistence.listProfiles(actor)).map(u => u.id))

  run('hides a test user from a non-super admin; the super admin and the test user see it', async () => {
    const admin = await listed(actorFor(ids.admin, 'vis.admin@example.com', 'admin'))
    expect(admin.has(ids.tester)).toBe(false)
    expect(admin.has(ids.ina)).toBe(true)

    expect((await listed(actorFor(ids.super, SUPER, 'admin'))).has(ids.tester)).toBe(true)

    const tester = actorFor(ids.tester, 'vis.tester@example.com', 'admin')
    expect((await listed(tester)).has(ids.tester)).toBe(true)

    const tree = new Set((await nativePeoplePersistence.listOrgTree(actorFor(ids.admin, 'vis.admin@example.com', 'admin'))).map(u => u.id))
    expect(tree.has(ids.tester)).toBe(false)
    expect(tree.has(ids.inb)).toBe(true)
  })

  run('limits a department-scoped admin to their departments', async () => {
    const scoped = await listed(actorFor(ids.admin, 'vis.admin@example.com', 'admin', ['VisA']))
    expect(scoped.has(ids.ina)).toBe(true)
    expect(scoped.has(ids.inb)).toBe(false)
    expect(scoped.has(ids.admin)).toBe(true)
  })
})

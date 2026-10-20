// tests/department-scope.test.ts
// Department boundary: admins/COs limited to some departments only reach
// people in those departments, cannot grant admin/CO, and cannot change
// org-wide setup or anyone's department access.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/db/types'

const { query, getPool, transaction } = vi.hoisted(() => ({ query: vi.fn(), getPool: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db/pool', () => ({ query, getPool, transaction }))

import { nativePeoplePersistence as people } from '@/lib/db/native/people'
import { nativeReferencePersistence as reference } from '@/lib/db/native/reference'
import { nativeTimesheetPersistence as timesheets } from '@/lib/db/native/timesheets'
import { adminTileAllowed } from '@/lib/navigation'

const admin: Actor = { id: 'admin-1', email: 'a@x.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true }

/** Routes SQL to canned rows: the actor's scope, in-scope target lookups, and writes. */
function db({ scope, inScope = true, known = [] as string[] }: { scope: string[] | null; inScope?: boolean; known?: string[] }) {
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith('select scope_departments as scope')) return [{ scope }]
    if (sql.includes('department = any($2)')) return inScope ? [{ ok: true }] : []
    if (sql.startsWith('select name from public.departments')) return (params[0] as string[]).filter(n => known.includes(n)).map(name => ({ name }))
    if (sql.startsWith('select 1 from public.departments') || sql.includes('from public.departments where name =')) return known.length ? [{ ok: 1 }] : []
    return []
  })
}
const writes = () => query.mock.calls.filter(([sql]) => /^\s*(update|insert|delete)/i.test(sql as string))

beforeEach(() => vi.resetAllMocks())

describe('department-limited admin', () => {
  it('manages a pm/user inside its departments', async () => {
    db({ scope: ['Engineering'] })
    expect(await people.updateUserStatus(admin, 'u-1', true)).toEqual({ error: null })
    expect(writes()).toHaveLength(1)
  })

  it('cannot touch a user outside its departments (or another admin)', async () => {
    db({ scope: ['Engineering'], inScope: false })
    expect((await people.updateUserStatus(admin, 'u-2', false)).error).toMatch(/permission/)
    expect(writes()).toHaveLength(0)
  })

  it('cannot grant admin or CO', async () => {
    db({ scope: ['Engineering'] })
    expect((await people.updateUserRoles(admin, 'u-1', 'admin', 'user')).error).toMatch(/PM or User/)
    expect((await people.updateUserRoles(admin, 'u-1', 'co', 'user')).error).toMatch(/PM or User/)
    expect(writes()).toHaveLength(0)
  })

  it('cannot change department access or the department list', async () => {
    db({ scope: ['Engineering'], known: ['Engineering'] })
    expect((await people.setDepartmentScope(admin, 'u-1', ['Engineering'])).error).toMatch(/without a department limit/)
    expect((await reference.createDepartment(admin, 'Sales')).error).toMatch(/without a department limit/)
    expect(writes()).toHaveLength(0)
  })

  it('cannot log time for someone outside its departments', async () => {
    db({ scope: ['Engineering'], inScope: false })
    const result = await timesheets.create(admin, { userId: 'u-2', projectId: 'p', activityTypeId: 'a', logDate: '2026-10-01', hoursWorked: 1, workDone: 'x' } as never)
    expect(result.error).toMatch(/outside your departments/)
  })

  it('loses the org-wide admin panels in navigation', () => {
    const access = { permission: 'admin' as const, hierarchy: 'user' as const, isActive: true, superAdmin: false, scoped: true }
    for (const id of ['settings', 'departments', 'global-reminders', 'import', 'backup'] as const) expect(adminTileAllowed(id, access)).toBe(false)
    expect(adminTileAllowed('user-whitelist', access)).toBe(true)
    expect(adminTileAllowed('settings', { ...access, scoped: false })).toBe(true)
  })
})

describe('unrestricted admin', () => {
  it('sets department access from the managed list only', async () => {
    db({ scope: null, known: ['Engineering'] })
    expect((await people.setDepartmentScope(admin, 'u-1', ['Nope'])).error).toMatch(/department list/)
    expect(await people.setDepartmentScope(admin, 'u-1', [' Engineering ', 'Engineering'])).toEqual({ error: null })
    expect(writes().at(-1)?.[1]).toEqual([['Engineering'], 'u-1'])
  })

  it('clears department access with an empty list', async () => {
    db({ scope: null })
    expect(await people.setDepartmentScope(admin, 'u-1', [])).toEqual({ error: null })
    expect(writes().at(-1)?.[1]).toEqual([null, 'u-1'])
  })

  it('refuses to delete a department that still has members', async () => {
    db({ scope: null })
    const client = { query: vi.fn(async (sql: string) => sql.includes('for update') ? { rows: [{ name: 'Engineering', members: 2 }] } : { rows: [] }) }
    transaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client))
    expect((await reference.deleteDepartment(admin, 'd-1')).error).toMatch(/2 member/)
    expect(client.query).not.toHaveBeenCalledWith('delete from public.departments where id = $1', ['d-1'])
  })
})

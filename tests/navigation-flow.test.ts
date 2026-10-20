import { describe, expect, it } from 'vitest'
import { buildNavGroups, classifyAccountView, resolveNavTiles, type NavAccess } from '../lib/navigation'

const nav = (access: NavAccess, saved: Parameters<typeof resolveNavTiles>[0]['saved'] = { dashboard: null, admin: null }) =>
  buildNavGroups(access, resolveNavTiles({ saved, defaults: null, access }))
const base: NavAccess = { permission: 'user', hierarchy: 'engineer', isActive: true, superAdmin: false }

describe('buildNavGroups', () => {
  it('gives pending accounts no menu', () => {
    expect(nav({ ...base, isActive: false })).toEqual([])
  })

  it('lists every personal tile as its own item for regular users', () => {
    const groups = nav(base)
    expect(groups.map(g => g.key)).toEqual(['my', 'team', 'reports'])
    expect(groups[0].items.map(i => i.href)).toContain('/dashboard?tab=user&panel=entries')
  })

  it('limits admin items to what the role may open', () => {
    const pm = nav({ ...base, permission: 'pm' })
    expect(pm.find(g => g.key === 'admin')?.items.map(i => i.key)).toEqual(['admin:project-manager'])
    const admin = nav({ ...base, permission: 'admin' })
    expect(admin.find(g => g.key === 'admin')?.items.some(i => i.key === 'admin:super-admin')).toBe(false)
    expect(nav({ ...base, permission: 'admin', superAdmin: true }).find(g => g.key === 'admin')?.items.some(i => i.key === 'admin:super-admin')).toBe(true)
  })

  it('honours saved order and hidden tiles but never hides super admin', () => {
    const groups = nav({ ...base, permission: 'admin', superAdmin: true }, {
      dashboard: { tiles: [{ id: 'leave', enabled: true }, { id: 'entry-form', enabled: false }] },
      admin: { tiles: [{ id: 'super-admin', enabled: false }] },
    })
    const my = groups[0].items.map(i => i.key)
    expect(my[0]).toBe('user:leave')
    expect(my).not.toContain('user:entry-form')
    expect(groups.find(g => g.key === 'admin')?.items.map(i => i.key)).toContain('admin:super-admin')
  })

  it('adds the team link for managers and team leads', () => {
    expect(nav({ ...base, hierarchy: 'team_lead' }).map(g => g.key)).toEqual(['my', 'team', 'reports'])
  })
})

describe('classifyAccountView', () => {
  it('routes a failed profile load to the error view, not pending approval', () => {
    expect(classifyAccountView(null, 'Network error.')).toBe('error')
  })

  it('treats a missing profile row as an error, not pending approval', () => {
    expect(classifyAccountView(null, null)).toBe('error')
  })

  it('shows the approval screen only for a loaded inactive profile', () => {
    expect(classifyAccountView({ is_active: false }, null)).toBe('pending')
  })

  it('admits a loaded active profile to the app', () => {
    expect(classifyAccountView({ is_active: true }, null)).toBe('ready')
  })
})

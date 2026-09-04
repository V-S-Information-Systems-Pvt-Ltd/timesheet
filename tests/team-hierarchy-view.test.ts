import { describe, it, expect } from 'vitest'
import { buildHierarchyTree } from '@/lib/hierarchy'
import { canViewTeamActor, getActorCapabilities } from '@/lib/roles'
import type { Actor } from '@/lib/db/repository'

describe('Slice 08: Shared Team Hierarchy View', () => {
  describe('Pure Hierarchy Tree Projection (buildHierarchyTree)', () => {
    it('correctly structures multi-level organizational trees', () => {
      const users = [
        { id: 'u-eng-1', name: 'Alice Engineer', email: 'alice@vsis.lk', manager_id: 'u-lead-1', hierarchy_role: 'engineer' },
        { id: 'u-mgr-1', name: 'Carol Manager', email: 'carol@vsis.lk', manager_id: null, hierarchy_role: 'manager' },
        { id: 'u-lead-1', name: 'Bob Lead', email: 'bob@vsis.lk', manager_id: 'u-mgr-1', hierarchy_role: 'team_lead' },
        { id: 'u-user-1', name: 'David User', email: 'david@vsis.lk', manager_id: 'u-lead-1', hierarchy_role: 'user' },
      ]

      const result = buildHierarchyTree(users)

      expect(result.roots).toHaveLength(1)
      const root = result.roots[0]
      expect(root.item.id).toBe('u-mgr-1')
      expect(root.depth).toBe(0)
      expect(root.children).toHaveLength(1)

      const lead = root.children[0]
      expect(lead.item.id).toBe('u-lead-1')
      expect(lead.depth).toBe(1)
      expect(lead.children).toHaveLength(2)

      // Sorted by role: engineer before user
      expect(lead.children[0].item.id).toBe('u-eng-1')
      expect(lead.children[1].item.id).toBe('u-user-1')
    })

    it('handles orphaned profiles with missing manager gracefully', () => {
      const users = [
        { id: 'u-orphan', name: 'Orphan User', email: 'orphan@vsis.lk', manager_id: 'u-nonexistent', hierarchy_role: 'user' },
        { id: 'u-root', name: 'Top Manager', email: 'top@vsis.lk', manager_id: null, hierarchy_role: 'manager' },
      ]

      const result = buildHierarchyTree(users)

      expect(result.roots).toHaveLength(2)
      expect(result.orphanCount).toBe(1)
      const orphanNode = result.roots.find((r) => r.item.id === 'u-orphan')
      expect(orphanNode).toBeDefined()
      expect(orphanNode?.isOrphan).toBe(true)
    })

    it('defensively detects cycles without infinite recursion', () => {
      const users = [
        { id: 'u-a', name: 'User A', email: 'a@vsis.lk', manager_id: 'u-b', hierarchy_role: 'manager' },
        { id: 'u-b', name: 'User B', email: 'b@vsis.lk', manager_id: 'u-a', hierarchy_role: 'manager' },
      ]

      const result = buildHierarchyTree(users)

      expect(result.roots.length).toBeGreaterThan(0)
      expect(result.orphanCount).toBeGreaterThan(0)
    })
  })

  describe('Role-gated Team Access Matrix', () => {
    it('authorizes admin, co, manager, and team_lead for team access', () => {
      const adminActor: Actor = { id: 'a1', email: 'admin@vsis.lk', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true }
      const coActor: Actor = { id: 'co1', email: 'co@vsis.lk', role: 'co', permission_role: 'co', hierarchy_role: 'user', isActive: true }
      const mgrActor: Actor = { id: 'm1', email: 'mgr@vsis.lk', role: 'user', permission_role: 'user', hierarchy_role: 'manager', isActive: true }
      const leadActor: Actor = { id: 'tl1', email: 'lead@vsis.lk', role: 'user', permission_role: 'user', hierarchy_role: 'team_lead', isActive: true }

      expect(canViewTeamActor(adminActor)).toBe(true)
      expect(canViewTeamActor(coActor)).toBe(true)
      expect(canViewTeamActor(mgrActor)).toBe(true)
      expect(canViewTeamActor(leadActor)).toBe(true)

      expect(getActorCapabilities(adminActor).canViewTeam).toBe(true)
      expect(getActorCapabilities(mgrActor).canViewTeam).toBe(true)
    })

    it('rejects PM (with user hierarchy), engineer, and regular user from team access', () => {
      const pmActor: Actor = { id: 'pm1', email: 'pm@vsis.lk', role: 'pm', permission_role: 'pm', hierarchy_role: 'user', isActive: true }
      const engActor: Actor = { id: 'eng1', email: 'eng@vsis.lk', role: 'user', permission_role: 'user', hierarchy_role: 'engineer', isActive: true }
      const userActor: Actor = { id: 'u1', email: 'user@vsis.lk', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }

      expect(canViewTeamActor(pmActor)).toBe(false)
      expect(canViewTeamActor(engActor)).toBe(false)
      expect(canViewTeamActor(userActor)).toBe(false)

      expect(getActorCapabilities(pmActor).canViewTeam).toBe(false)
      expect(getActorCapabilities(engActor).canViewTeam).toBe(false)
      expect(getActorCapabilities(userActor).canViewTeam).toBe(false)
    })
  })
})

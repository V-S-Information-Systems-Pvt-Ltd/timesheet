// app/dashboard/team-view.tsx
// Team Directory & Expandable Reporting Tree view on Web.
'use client'

import { useMemo, useState } from 'react'
import type { HierarchyRole, User } from '../types'
import { HIERARCHY_ROLE_LABELS } from '@/lib/roles'
import { buildHierarchyTree, type HierarchyTreeNode } from '@/lib/hierarchy'
import { Button, Card, Field, Input } from '@/app/components/ui'
import { IconUsers, IconChevronDown, IconChevronRight } from '@/app/components/icons'

interface TeamViewProps {
  users: User[]
  onSelectUser?: (user: User) => void
}

type ViewMode = 'tree' | 'directory'

export default function TeamView({ users, onSelectUser }: TeamViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const roots = users.filter((u) => !u.manager_id)
    return new Set(roots.map((r) => r.id))
  })

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q) ||
        (u.title || '').toLowerCase().includes(q)
    )
  }, [users, search])

  const treeResult = useMemo(() => {
    return buildHierarchyTree(filteredUsers)
  }, [filteredUsers])

  const renderRoleBadge = (u: User) => {
    const role: HierarchyRole = u.hierarchy_role || 'user'
    const isLeader = role === 'manager' || role === 'team_lead'
    return (
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
          isLeader
            ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900'
            : role === 'engineer'
            ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900'
            : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
        }`}
      >
        {HIERARCHY_ROLE_LABELS[role] ?? role}
      </span>
    )
  }

  const renderTreeNode = (node: HierarchyTreeNode<User>) => {
    const u = node.item
    const hasChildren = node.children.length > 0
    const isExpanded = expandedIds.has(u.id)
    const paddingLeft = `${node.depth * 1.5}rem`

    return (
      <div key={u.id} className="space-y-1">
        <div
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 shadow-xs hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"
          style={{ marginLeft: paddingLeft }}
        >
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} reports for ${u.name || u.email}`}
                onClick={() => toggleExpand(u.id)}
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              >
                {isExpanded ? <IconChevronDown className="h-4 w-4" /> : <IconChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <div className="h-6 w-6" />
            )}

            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
              {(u.name || u.email || 'U')[0].toUpperCase()}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200">{u.name || 'No name'}</span>
                {renderRoleBadge(u)}
                {node.isOrphan && (
                  <span className="text-[10px] text-amber-600 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                    Orphan
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">
                {u.email}
                {u.title ? ` • ${u.title}` : ''}
                {u.department ? ` • ${u.department}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasChildren && (
              <span className="text-xs font-medium text-slate-400">
                {node.children.length} direct {node.children.length === 1 ? 'report' : 'reports'}
              </span>
            )}
            {onSelectUser && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelectUser(u)}
                aria-label={`View timesheets for ${u.name || u.email}`}
              >
                View Timesheets →
              </Button>
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="space-y-1">
            {node.children.map((child) => renderTreeNode(child))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card
      title="Team Directory & Org Tree"
      subtitle="View organizational reporting structure, titles, and team members"
      icon={<IconUsers className="h-4.5 w-4.5" />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'tree'}
                onClick={() => setViewMode('tree')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  viewMode === 'tree'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                Org Tree
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'directory'}
                onClick={() => setViewMode('directory')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  viewMode === 'directory'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                Directory ({users.length})
              </button>
            </div>
          </div>

          <Field label="" className="max-w-md flex-1">
            <Input
              placeholder="Search team member by name, email, department, or title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs"
              aria-label="Search team members"
            />
          </Field>
        </div>

        {viewMode === 'tree' ? (
          <div className="space-y-2">
            {treeResult.roots.map((rootNode) => renderTreeNode(rootNode))}
            {treeResult.roots.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">
                No team members match &quot;{search.trim()}&quot;.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-3.5 py-2.5">Member</th>
                  <th className="px-3.5 py-2.5">Title</th>
                  <th className="px-3.5 py-2.5">Hierarchy Role</th>
                  <th className="px-3.5 py-2.5">Department</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className="px-3.5 py-3">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {u.name || 'No name'}
                      </div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-3.5 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {u.title || '—'}
                    </td>
                    <td className="px-3.5 py-3">{renderRoleBadge(u)}</td>
                    <td className="px-3.5 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {u.department || '—'}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      {onSelectUser && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onSelectUser(u)}
                          aria-label={`View timesheets for ${u.name || u.email}`}
                        >
                          View Timesheets →
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3.5 py-6 text-center text-xs text-slate-400">
                      No team members match &quot;{search.trim()}&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

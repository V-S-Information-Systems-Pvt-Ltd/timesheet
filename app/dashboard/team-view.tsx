// app/dashboard/team-view.tsx
// Team Directory & Expandable Reporting Tree view on Web.
'use client'

import { useMemo, useState } from 'react'
import type { HierarchyRole, User } from '../types'
import { HIERARCHY_ROLE_LABELS } from '@/lib/roles'
import { buildHierarchyTree, type HierarchyTreeNode } from '@/lib/hierarchy'
import { Badge, Button, Card, DataTable, EmptyState, Field, IconButton, Input, SegmentedTabs } from '@/app/components/ui'
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
      <Badge tone={isLeader ? 'blue' : 'slate'}>
        {HIERARCHY_ROLE_LABELS[role] ?? role}
      </Badge>
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
          className="flex items-center justify-between rounded-lg border border-border bg-card p-3 shadow-card hover:border-border"
          style={{ marginLeft: paddingLeft }}
        >
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <IconButton
                size="sm"
                label={`${isExpanded ? 'Collapse' : 'Expand'} reports for ${u.name || u.email}`}
                aria-expanded={isExpanded}
                onClick={() => toggleExpand(u.id)}
                className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
              >
                {isExpanded ? <IconChevronDown className="h-4 w-4" /> : <IconChevronRight className="h-4 w-4" />}
              </IconButton>
            ) : (
              <div className="h-6 w-6" />
            )}

            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
              {(u.name || u.email || 'U')[0].toUpperCase()}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-fg">{u.name || 'No name'}</span>
                {renderRoleBadge(u)}
                {node.isOrphan && (
                  <Badge tone="amber">Orphan</Badge>
                )}
              </div>
              <div className="text-xs text-fg-muted">
                {u.email}
                {u.title ? ` • ${u.title}` : ''}
                {u.department ? ` • ${u.department}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasChildren && (
              <span className="text-xs font-medium text-fg-muted">
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
          <SegmentedTabs<ViewMode>
            value={viewMode}
            onChange={setViewMode}
            options={[
              { key: 'tree', label: 'Org Tree' },
              { key: 'directory', label: `Directory (${users.length})` },
            ]}
          />

          <Field className="max-w-md flex-1">
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
              <EmptyState title="No matching team members" description={`No team members match "${search.trim()}".`} className="py-6" />
            )}
          </div>
        ) : (
          <DataTable<User>
            className="rounded-xl border border-border"
            caption="Team directory"
            rows={filteredUsers}
            rowKey={(u) => u.id}
            empty={<EmptyState title="No matching team members" description={`No team members match "${search.trim()}".`} className="py-6" />}
            columns={[
              {
                key: 'member', header: 'Member',
                cell: (u) => <><div className="font-medium text-fg">{u.name || 'No name'}</div><div className="text-xs text-fg-muted">{u.email}</div></>,
              },
              { key: 'title', header: 'Title', cell: (u) => u.title || '—' },
              { key: 'role', header: 'Hierarchy Role', cell: renderRoleBadge },
              { key: 'department', header: 'Department', cell: (u) => u.department || '—' },
              {
                key: 'actions', header: 'Actions', align: 'right',
                cell: (u) => onSelectUser && (
                  <Button variant="ghost" size="sm" onClick={() => onSelectUser(u)} aria-label={`View timesheets for ${u.name || u.email}`}>
                    View Timesheets →
                  </Button>
                ),
              },
            ]}
          />
        )}
      </div>
    </Card>
  )
}

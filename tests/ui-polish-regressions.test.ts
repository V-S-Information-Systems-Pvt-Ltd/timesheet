import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HierarchyEditor from '@/app/dashboard/hierarchy-editor'
import { Menu } from '@/app/components/ui'
import type { User } from '@/app/types'

const user: User = {
  id: 'user-1', email: 'alice@example.test', name: 'Alice Example', department: 'Engineering',
  title: 'Systems Engineer', role: 'user', permission_role: 'user', hierarchy_role: 'engineer',
  is_active: true, manager_id: null, dashboard_layout: null, admin_layout: null, mobile_layout: null, created_at: '2026-01-01T00:00:00Z',
}

describe('UI polish contract regressions', () => {
  it('renders user identity in a labelled hierarchy cell that survives the mobile stack', () => {
    const html = renderToStaticMarkup(createElement(HierarchyEditor, { users: [user], onChanged: () => {} }))
    const cell = html.match(/<td\b[^>]*data-label="User"[^>]*>([\s\S]*?)<\/td>/)?.[1]
    expect(cell).toContain('Alice Example')
    expect(cell).toContain('alice@example.test')
  })

  it('disables the row menu trigger while retained rows have no authoritative read', () => {
    const html = renderToStaticMarkup(createElement(Menu, {
      label: 'Entry actions', trigger: 'Actions', disabled: true,
      items: [{ label: 'Edit', onSelect: () => {} }],
    }))
    expect(html).toMatch(/<button\b[^>]*disabled=""/)
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps the row menu available after a successful read', () => {
    const html = renderToStaticMarkup(createElement(Menu, {
      label: 'Entry actions', trigger: 'Actions',
      items: [{ label: 'Edit', onSelect: () => {} }],
    }))
    expect(html).not.toContain('disabled=""')
  })
})

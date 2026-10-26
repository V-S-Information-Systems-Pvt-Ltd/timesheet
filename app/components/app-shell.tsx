// app/components/app-shell.tsx
// Authenticated application frame: a left accordion sidebar (every dashboard
// panel is its own menu item), a top bar with breadcrumb and account menu, and
// the page content. Below lg the sidebar becomes an off-canvas drawer.
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { UserRole } from '@/app/types'
import type { NavGroup } from '@/lib/navigation'
import { isFormField, focusBySelector, SHORTCUTS } from '@/lib/shortcuts'
import { cn } from './cn'
import { Dialog } from './dialog'
import { MenuCustomizer, type MenuCustomizerConfig } from './menu-customizer'
import { Menu } from './menu'
import { useBranding } from './branding-provider'
import { BrandMark, IconButton, RoleBadge, ThemeToggle, initialsOf } from './ui'
import { IconChart, IconChevronDown, IconClock, IconDashboard, IconMenu, IconUsers, IconX } from './icons'

const GROUP_ICONS: Record<NavGroup['key'], ReactNode> = {
  my: <IconClock className="h-[18px] w-[18px]" />,
  team: <IconUsers className="h-[18px] w-[18px]" />,
  admin: <IconDashboard className="h-[18px] w-[18px]" />,
  reports: <IconChart className="h-[18px] w-[18px]" />,
}

/** Dashboard panel links swap the search params in place (no server round trip). */
function navigateInPlace(event: MouseEvent<HTMLAnchorElement>, href: string, pathname: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return false
  const [path] = href.split('?')
  if (path !== pathname || pathname !== '/dashboard') return false
  event.preventDefault()
  window.history.pushState(null, '', href)
  return true
}

function SidebarNav({
  groups,
  activeNav,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[]
  activeNav?: string
  pathname: string
  onNavigate: () => void
}) {
  const baseId = useId()
  const activeGroup = groups.find(g => g.items.some(i => i.key === activeNav))?.key
  // Only the section holding the current page starts open; moving to another
  // section opens it too (render-time adjustment, no effect).
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []))
  const [seenGroup, setSeenGroup] = useState(activeGroup)
  if (activeGroup !== seenGroup) {
    setSeenGroup(activeGroup)
    if (activeGroup && !open.has(activeGroup)) setOpen(new Set([...open, activeGroup]))
  }
  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const linkCls = (active: boolean, nested: boolean) => cn(
    'relative flex min-h-10 items-center gap-3 rounded-md pr-3 text-sm transition-colors',
    nested ? 'pl-10' : 'pl-3 font-medium',
    active
      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-100 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary-600 dark:before:bg-primary-300'
      : 'text-fg-muted hover:bg-muted hover:text-fg'
  )

  return (
    <ul className="space-y-1">
      {groups.map(group => {
        if (group.items.length === 0) {
          const active = activeNav === group.key
          return (
            <li key={group.key}>
              <Link
                href={group.href ?? '#'}
                aria-current={active ? 'page' : undefined}
                className={linkCls(active, false)}
                onClick={(e) => { navigateInPlace(e, group.href ?? '', pathname); onNavigate() }}
              >
                {GROUP_ICONS[group.key]}
                {group.label}
              </Link>
            </li>
          )
        }
        const expanded = open.has(group.key)
        const panelId = `${baseId}-${group.key}`
        return (
          <li key={group.key}>
            <div className="group/head flex items-center">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(group.key)}
                className={cn(
                  'flex min-h-10 flex-1 items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-muted',
                  activeGroup === group.key ? 'text-fg' : 'text-fg-muted hover:text-fg'
                )}
              >
                {GROUP_ICONS[group.key]}
                <span className="flex-1">{group.label}</span>
                <IconChevronDown className={cn('h-4 w-4 text-fg-subtle transition-transform duration-200', !expanded && '-rotate-90')} />
              </button>
            </div>
            <div
              id={panelId}
              className={cn('grid transition-[grid-template-rows] duration-200 ease-out', expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
            >
              <ul className="min-h-0 overflow-hidden" inert={!expanded}>
                {group.items.map(item => {
                  const active = item.key === activeNav
                  return (
                    <li key={item.key} className="mt-0.5">
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={linkCls(active, true)}
                        onClick={(e) => { navigateInPlace(e, item.href, pathname); onNavigate() }}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function AppShell({
  name,
  email,
  department,
  role,
  isActive = true,
  onLogout,
  centered = false,
  nav = [],
  activeNav,
  breadcrumb,
  customizer,
  children,
}: {
  name?: string
  email?: string
  department?: string
  role: UserRole
  isActive?: boolean
  onLogout: () => void
  centered?: boolean
  nav?: NavGroup[]
  activeNav?: string
  /** Trail shown in the top bar, e.g. ['Administration', 'Settings']. */
  breadcrumb?: string[]
  /** Enables the sidebar's "Customize menu" button and dialog. */
  customizer?: MenuCustomizerConfig
  children: ReactNode
}) {
  const displayName = name || email || 'User'
  const branding = useBranding()
  const router = useRouter()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  // Focus can only return to the menu button once the page is no longer inert,
  // so dismissal sets this flag and the effect below restores focus after commit.
  const restoreFocus = useRef(false)

  useEffect(() => {
    if (drawerOpen || !restoreFocus.current) return
    restoreFocus.current = false
    hamburgerRef.current?.focus()
  }, [drawerOpen])

  useEffect(() => {
    // Close the drawer on route change. This is a deliberate sync from URL state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const drawer = drawerRef.current
    if (!drawer) return
    const focusable = () => Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
      .filter(el => !el.closest('[inert]'))
    focusable()[0]?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', trap)
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isFormField(document.activeElement)) return
      if (e.metaKey || e.altKey || e.ctrlKey) return
      const key = e.key?.toLowerCase() ?? ''
      if (key === 'escape' && drawerOpen) {
        restoreFocus.current = true
        setDrawerOpen(false)
        return
      }
      if (shortcutsOpen) return
      let handled = false
      switch (key) {
        case 'n': handled = focusBySelector('[data-shortcut="time-entry-form"]'); break
        case 'e': handled = focusBySelector('[data-shortcut="edit-last"]'); break
        case 'u': handled = focusBySelector('[data-shortcut="undo-last"]'); break
        // The project picker only renders once Type is "Project"; fall back to the Type select.
        case '/': handled = focusBySelector('[data-shortcut="time-entry-form"] input[id$="-project"]') ||
          focusBySelector('[data-shortcut="time-entry-form"] select[id$="-type"]'); break
        case '?': setShortcutsOpen(true); handled = true; break
      }
      if (handled) e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, shortcutsOpen])

  const brand = (
    <Link href="/dashboard" className="flex h-16 shrink-0 items-center gap-2.5 px-5">
      <BrandMark className="h-8" />
      <span className="truncate font-display text-[15px] font-semibold tracking-tight text-fg">
        {branding.appName || 'Timesheet'}
      </span>
    </Link>
  )

  const sidebarBody = (inDrawer: boolean) => (
    <>
      <nav aria-label="Main" className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {nav.length > 0 ? (
          <SidebarNav
            groups={nav}
            activeNav={activeNav}
            pathname={pathname}
            onNavigate={() => setDrawerOpen(false)}
          />
        ) : (
          <p className="px-3 text-sm text-fg-muted">Menu appears once your account is active.</p>
        )}
      </nav>
      <div className="border-t border-line px-3 py-3">
        {customizer && nav.length > 0 && (
          <button
            type="button"
            onClick={() => { setDrawerOpen(false); customizer.onOpenChange(true) }}
            className="flex min-h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-fg-muted transition-colors hover:bg-muted hover:text-fg"
          >
            <IconDashboard className="h-4 w-4" />
            Customize menu
          </button>
        )}
        <button
          type="button"
          onClick={() => { setDrawerOpen(false); setShortcutsOpen(true) }}
          className="flex min-h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-fg-muted transition-colors hover:bg-muted hover:text-fg"
        >
          <kbd className="rounded border border-border bg-muted px-1.5 text-xs">?</kbd>
          Keyboard shortcuts
        </button>
        {inDrawer && <ThemeToggle className="mt-2" />}
      </div>
    </>
  )

  const accountItems = [
    ...(isActive ? [{ label: 'Change password', onSelect: () => router.push('/change-password') }] : []),
    { label: 'Keyboard shortcuts', onSelect: () => setShortcutsOpen(true) },
    { label: 'Log out', onSelect: onLogout, destructive: true },
  ]

  return (
    <div className="min-h-screen bg-surface lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-card lg:flex">
        {brand}
        {sidebarBody(false)}
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-0 z-50 transition-opacity duration-200 lg:hidden',
          drawerOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none invisible opacity-0'
        )}
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
      >
        <div className="absolute inset-0 bg-black/30" />
        <aside
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className={cn(
            'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl transition-transform duration-200',
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pr-3">
            {brand}
            <IconButton label="Close navigation menu" onClick={() => { restoreFocus.current = true; setDrawerOpen(false) }}>
              <IconX className="h-5 w-5" />
            </IconButton>
          </div>
          {sidebarBody(true)}
        </aside>
      </div>

      <div className="flex min-h-screen min-w-0 flex-col" aria-hidden={drawerOpen} inert={drawerOpen}>
        <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-line bg-card/90 px-3 backdrop-blur sm:px-4 md:px-6">
          <button
            ref={hamburgerRef}
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="inline-flex shrink-0 items-center justify-center rounded-lg p-2.5 text-fg-muted transition-colors hover:bg-muted hover:text-fg lg:hidden"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          {breadcrumb && breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                {breadcrumb.map((crumb, i) => {
                  const last = i === breadcrumb.length - 1
                  return (
                    <li key={i} className={cn('flex min-w-0 items-center gap-1.5', !last && 'hidden sm:flex')}>
                      {i > 0 && <span aria-hidden className="hidden text-fg-subtle sm:inline">/</span>}
                      <span className={cn('truncate', last ? 'font-medium text-fg' : 'text-fg-muted')} aria-current={last ? 'page' : undefined}>
                        {crumb}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="hidden sm:block"><ThemeToggle /></span>
            <Menu
              label="Account menu"
              items={accountItems}
              trigger={
                <span className="flex items-center gap-2.5 px-1">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-600 font-display text-xs font-semibold text-white">
                    {initialsOf(name, email)}
                  </span>
                  <span className="hidden text-left leading-tight md:block">
                    <span className="block max-w-[160px] truncate text-sm font-medium text-fg">{displayName}</span>
                    <span className="flex items-center gap-1.5">
                      {department && <span className="max-w-[110px] truncate text-[11px] text-fg-muted">{department}</span>}
                      <RoleBadge role={role} />
                    </span>
                  </span>
                  <IconChevronDown className="hidden h-4 w-4 text-fg-subtle md:block" />
                </span>
              }
            />
          </div>
        </header>

        <main
          id="main-content"
          className={cn(
            'flex-1',
            centered
              ? 'flex items-center justify-center px-4 py-10'
              : 'w-full px-4 py-6 md:px-8 md:py-8'
          )}
        >
          {children}
        </main>
      </div>

      {customizer && <MenuCustomizer config={customizer} />}

      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        labelledBy="shortcuts-title"
        className="w-full max-w-md rounded-xl bg-card shadow-xl"
      >
        <div data-shortcuts-modal>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h3 id="shortcuts-title" className="font-display text-sm font-semibold tracking-tight text-fg">Keyboard shortcuts</h3>
            <IconButton size="sm" label="Close shortcuts" onClick={() => setShortcutsOpen(false)}>
              <IconX className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="max-h-80 overflow-y-auto p-5">
            {Object.entries(
              SHORTCUTS.reduce<Record<string, typeof SHORTCUTS[number][]>>((acc, s) => {
                (acc[s.section] ??= []).push(s)
                return acc
              }, {})
            ).map(([section, items]) => (
              <div key={section} className="mb-4 last:mb-0">
                <h4 className="mb-2 text-xs font-semibold text-fg-subtle">{section}</h4>
                <div className="space-y-1.5">
                  {items.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-fg-muted">{s.description}</span>
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-fg-muted">{s.keys}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  )
}

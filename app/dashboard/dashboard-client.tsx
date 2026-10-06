// app/dashboard/dashboard-client.tsx
// Dashboard: state + fetch orchestration. The forms, tables, and admin
// panels live in their own components under app/dashboard/.
'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useTransition, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient, type ClientSessionUser } from '@/lib/auth/client'
import { dataClient } from '@/lib/data/client'
import { AdminDashboardLayout, AdminTileId, DashboardLayout, User, Project, Timesheet, ActivityType, TileId, OptimisticTimesheet } from '../types'
import { todayISO } from '@/lib/dates'
import { createDashboardMonthTotals, type DashboardMonthTotalsState } from '@/lib/dashboard-month-totals'
import { createTimesheetPageReader, entriesPageFromSearch, entriesPageQuery, mergePageOverlays, type TimesheetPageState } from '@/lib/dashboard-timesheets'
import { insertOptimisticTimesheet, isTemporaryTimesheetId } from '@/lib/optimistic-timesheets'
import { backfillMinDate, type BackfillSettings } from '@/lib/validation'
import { ADMIN_TILE_IDS, ADMIN_TILE_LABELS, DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT, TILE_LABELS } from '../constants'
import { completeLayout, forceTileEnabled, resolveLayout } from '@/lib/layout'
import dynamic from 'next/dynamic'
import ProjectManager from './project-manager'
import LeavePanel from './leave-panel'
import RemindersPanel from './reminders-panel'
import GlobalRemindersPanel, { GlobalReminderBanners, GlobalRemindersProvider } from './global-reminders-panel'
import SettingsPanel from './settings-panel'
import TimeEntryForm, { useBrowserToday } from './time-entry-form'
import EntriesTable from './entries-table'
import AddUserForm from './add-user-form'
import BackfillForm from './backfill-form'
import UserWhitelist from './user-whitelist'
import ReportExport from './report-export'
import ActivityTypesPanel from './activity-types-panel'
import MyProfilePanel from './my-profile-panel'
import TelegramPanel from './telegram-panel'
import PanelCustomizer from './panel-customizer'
import { AppShell, Button, Card, PageHeader, SegmentedTabs, SkeletonCard, LoadingState, Alert } from '@/app/components/ui'
import { IconAlert, IconClock, IconUsers } from '@/app/components/icons'
import { classifyAccountView } from '@/lib/navigation'
import { createDashboardAuthHandoff, dashboardPageScope, sameDashboardAuthorization, type DashboardSeed } from '@/lib/dashboard-seed'

const SuperAdminPanel = dynamic(() => import('./super-admin-panel'), {
  loading: () => <SkeletonCard className="h-64" />,
})
const ImportPanel = dynamic(() => import('./import-panel'), {
  loading: () => <SkeletonCard className="h-64" />,
})
const BackupPanel = dynamic(() => import('./backup-panel'), {
  loading: () => <SkeletonCard className="h-64" />,
})
const HierarchyEditor = dynamic(() => import('./hierarchy-editor'), {
  loading: () => <SkeletonCard className="h-64" />,
})
const TeamView = dynamic(() => import('./team-view'), {
  loading: () => <SkeletonCard className="h-64" />,
})

const DEFAULT_BACKFILL: BackfillSettings = { mode: 'days', windowDays: 1, extraDays: 0 }

export default function DashboardClient({ seed: incomingSeed }: { seed: DashboardSeed }) {
  // Later RSC navigation cannot replace a live controller/session/mutation.
  const [seed] = useState(() => incomingSeed)
  const authGeneration = useRef(0)
  const sessionRef = useRef(seed.session)
  const [authHandoff] = useState(() => createDashboardAuthHandoff(seed.session, seed.identityError))
  const initialScope = seed.session && seed.profile?.is_active
    ? dashboardPageScope(0, seed.session.id, seed.page) : ''
  const [initialPage] = useState<TimesheetPageState>(() => ({
    scope: initialScope, rows: seed.entries.data?.rows ?? [], count: seed.entries.data?.count ?? null,
    loading: !seed.session, error: seed.entries.error,
  }))
  const router = useRouter()
  const [user, setUser] = useState<ClientSessionUser | null>(seed.session)
  const [profile, setProfile] = useState<User | null>(seed.profile)
  const [projects, setProjects] = useState<Project[]>(seed.projects.data ?? [])
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>(seed.activityTypes.data ?? [])
  const [timesheets, setTimesheets] = useState<Timesheet[]>(initialPage.rows)
  const [timesheetRevision, setTimesheetRevision] = useState(0)
  const [pageState, setPageState] = useState<TimesheetPageState>(initialPage)
  const [todayPresence, setTodayPresence] = useState<{ logged: boolean; loading: boolean; error: string | null }>({ logged: false, loading: true, error: null })
  const todaySequence = useRef(0)
  const currentUserRef = useRef<string | undefined>(seed.session?.id)
  const profileRef = useRef(seed.profile)
  const profileSequence = useRef(0)
  const [identityError, setIdentityError] = useState(seed.identityError)
  const [allUsers, setAllUsers] = useState<User[]>(seed.people.data ?? [])
  const [backfillSettings, setBackfillSettings] = useState<BackfillSettings>(seed.backfill.data ?? DEFAULT_BACKFILL)
  const [loading, setLoading] = useState(!seed.session && !seed.identityError)
  const [resourceErrors, setResourceErrors] = useState<Record<string, string | null>>(() => ({
    projects: seed.projects.error, activities: seed.activityTypes.error, people: seed.people.error,
    backfill: seed.backfill.error, layouts: seed.layouts.error,
  }))
  const dataError = Object.values(resourceErrors).filter(Boolean).join(' ') || null
  const [monthTotals, setMonthTotals] = useState<DashboardMonthTotalsState>({ status: 'loading', totals: null, error: null })
  const [monthTotalsRequest] = useState(() => createDashboardMonthTotals(
    query => dataClient.getReportTotals(query, { deduplicate: false }), setMonthTotals,
    seed.profile?.is_active ? seed.session?.id ?? null : null,
  ))
  const [authEpoch, setAuthEpoch] = useState(0)
  // Profile-load failure (network/500/missing row). Kept separate from
  // dataError so it can never be presented as "Account Pending Approval".
  const [profileError, setProfileError] = useState<string | null>(seed.profileError)
  const [superAdmin, setSuperAdmin] = useState(seed.isSuperAdmin)
  // Global default panel order (super-admin-editable); used as the fallback
  // layout for users without a saved per-user layout.
  const [defaultLayouts, setDefaultLayouts] = useState<{
    dashboard: DashboardLayout
    admin: AdminDashboardLayout
  } | null>(seed.layouts.data)
  // Pending overlays belong to the current page scope; the reader owns stale
  // response rejection independently of optimistic mutation reconciliation.
  const pendingTimesheets = useRef(new Map<string, Timesheet | null>())
  const serverTimesheetOrder = useRef<string[]>(initialPage.rows.map(row => row.id))
  const currentScopeRef = useRef(initialScope)
  const initialPageConsumed = useRef(false)
  const [pageReader] = useState(() => createTimesheetPageReader(
    query => dataClient.getTimesheets(query, { deduplicate: false }),
    setPageState,
    { state: initialPage, query: entriesPageQuery(seed.page) },
  ))
  // Dashboard-owned locks survive the entries table unmounting on a tab change.
  const [mutationLocks] = useState(() => new Set<string>())
  const [busyTimesheetIds, setBusyTimesheetIds] = useState<Set<string>>(new Set())
  const setTimesheetBusy = useCallback((id: string, busy: boolean) => {
    if (authEpoch !== authGeneration.current) return
    if (busy) mutationLocks.add(id)
    else mutationLocks.delete(id)
    monthTotalsRequest.setBusy(mutationLocks.size > 0)
    setBusyTimesheetIds(new Set(mutationLocks))
  }, [mutationLocks, monthTotalsRequest, authEpoch])
  const searchParams = useSearchParams()
  const role = profile?.role ?? 'user'
  const permission = profile?.permission_role ?? 'user'
  const hierarchy = profile?.hierarchy_role ?? 'user'
  const isAdmin = permission === 'admin'
  const canManageProjects = isAdmin || permission === 'pm'
  const canGenerateReports = isAdmin || permission === 'co'
  // Admins/COs see all entries; managers and team leads see their team (by
  // HIERARCHY position, independent of permission). All of them can pick whose
  // entries are visible at a time.
  const canSeeTeamEntries =
    isAdmin || permission === 'co' || hierarchy === 'manager' || hierarchy === 'team_lead'
  const canViewTeam = canSeeTeamEntries
  const showAdminPanel = isAdmin || canManageProjects || canGenerateReports
  const entriesPage = entriesPageFromSearch(searchParams)
  if (!canSeeTeamEntries) entriesPage.user = ''
  const pageScope = user && profile?.is_active
    ? dashboardPageScope(authEpoch, user.id, entriesPage) : ''
  const displayedTimesheets = pageState.scope === pageScope ? timesheets : []
  const isSessionCurrent = () => authEpoch === authGeneration.current
  useLayoutEffect(() => {
    currentScopeRef.current = pageScope
    currentUserRef.current = user?.id
  }, [pageScope, entriesPage.user, user?.id])
  useLayoutEffect(() => {
    if (pageState.scope !== pageScope) return
    serverTimesheetOrder.current = pageState.rows.map(row => row.id)
    // Reconcile imperative pending writes only when server page state changes.
    setTimesheets(mergePageOverlays(pageState.rows, pendingTimesheets.current, entriesPage.user))
  }, [pageState, pageScope, entriesPage.user])

  // Read activeTab from URL (SSR-safe via useSearchParams), clamping by role permissions
  const rawTab = searchParams?.get('tab')
  const urlTab =
    rawTab === 'admin' && showAdminPanel
      ? 'admin'
      : rawTab === 'team' && canViewTeam
        ? 'team'
        : 'user'
  const effectiveTab = urlTab
  const [activeTab, setActiveTab] = useState<'user' | 'team' | 'admin'>(effectiveTab)
  const [isPending, startTransition] = useTransition()

  // Keep local tab state in sync with the URL-derived value using the
  // render-time adjustment pattern (React 19) instead of a setState-in-effect,
  // so there is a single source of truth for the active tab.
  if (activeTab !== effectiveTab) setActiveTab(effectiveTab)

  const handleTabChange = (tab: 'user' | 'team' | 'admin', selectedUser?: string) => {
    startTransition(() => {
      setActiveTab(tab)
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('tab', tab)
      if (selectedUser !== undefined) { params.set('user', selectedUser); params.delete('page') }
      window.history.replaceState(null, '', `?${params.toString()}`)
    })
  }

  // Backfill window: the earliest date regular users may log or edit.
  const today = useBrowserToday()
  // No editable historical boundary until the browser confirms its local day.
  const minLogDate = today ? backfillMinDate(today, backfillSettings) : '9999-12-31'

  const readResource = useCallback(async <T,>(key: string, read: () => Promise<{ data: T | null; error?: string | null }>, apply: (data: T) => void) => {
    const generation = authGeneration.current
    let result: { data: T | null; error?: string | null }
    try { result = await read() }
    catch { result = { data: null, error: `Could not load ${key}.` } }
    if (generation !== authGeneration.current) return
    setResourceErrors(prev => ({ ...prev, [key]: result.error ?? null }))
    if (result.data) apply(result.data)
  }, [])
  const fetchProjects = useCallback(() => readResource('projects', () => dataClient.getProjects({ deduplicate: false }), setProjects), [readResource])
  const fetchActivityTypes = useCallback(() => readResource('activities', () => dataClient.getActivityTypes({ deduplicate: false }), setActivityTypes), [readResource])

  const fetchTimesheets = useCallback(() => pageReader.refresh(), [pageReader])
  const fetchToday = useCallback(async () => {
    const id = currentUserRef.current
    if (!id) return
    const sequence = ++todaySequence.current
    const generation = authGeneration.current
    setTodayPresence(prev => ({ ...prev, loading: true, error: null }))
    const date = todayISO()
    const result = await dataClient.getTimesheets({ userId: id, dateFrom: date, dateTo: date, limit: 1, includeCount: false }, { deduplicate: false })
    if (sequence !== todaySequence.current || generation !== authGeneration.current) return
    setTodayPresence({ logged: Boolean(result.data?.length), loading: false, error: result.error })
  }, [])

  useEffect(() => {
    if (!initialPageConsumed.current && pageScope === initialPage.scope && seed.session) {
      initialPageConsumed.current = true
      return () => pageReader.invalidate()
    }
    initialPageConsumed.current = true
    pendingTimesheets.current.clear()
    pageReader.reset(pageScope, entriesPageQuery({ user: entriesPage.user, page: entriesPage.page, size: entriesPage.size }))
    if (pageScope) void pageReader.refresh()
    return () => pageReader.invalidate()
  }, [pageScope, entriesPage.user, entriesPage.page, entriesPage.size, pageReader, initialPage.scope, seed.session])

  useEffect(() => {
    if (seed.month) monthTotalsRequest.hydrate(seed.month.state, seed.month.range)
  }, [seed, monthTotalsRequest])

  useEffect(() => {
    if (profile?.is_active) void fetchToday()
  }, [profile?.id, profile?.is_active, authEpoch, fetchToday])

  const fetchAllUsers = useCallback(() => readResource('people', () => dataClient.getAllUsers({ deduplicate: false }), setAllUsers), [readResource])

  const refreshTimesheetData = useCallback(() => {
    // Aggregate failures must not determine optimistic row rollback/recovery.
    void monthTotalsRequest.refresh()
    void fetchToday()
    setTimesheetRevision(n => n + 1)
    return fetchTimesheets()
  }, [fetchTimesheets, monthTotalsRequest, fetchToday])

  // Optimistic mutators over the entries list, so EntriesTable can reflect
  // duplicate/edit/delete instantly and reconcile against fetchTimesheets()
  // (the same temp-row + refetch pattern as handleLogged below).
  const insertTimesheet = useCallback((entry: Timesheet) => {
    if (authEpoch !== authGeneration.current || currentScopeRef.current !== pageScope || !pageScope) return
    // Real off-page rows (bulk rollback) and other users never enter this page.
    if (entriesPage.user && entry.user_id !== entriesPage.user) return
    if (!isTemporaryTimesheetId(entry.id) && !serverTimesheetOrder.current.includes(entry.id)) return
    pendingTimesheets.current.set(entry.id, entry)
    const order = serverTimesheetOrder.current
    setTimesheets(prev => insertOptimisticTimesheet(prev, entry, order))
  }, [pageScope, entriesPage.user, authEpoch])
  const updateTimesheetRow = useCallback((id: string, patch: Partial<Timesheet>) => {
    if (authEpoch !== authGeneration.current || currentScopeRef.current !== pageScope || !pageScope) return
    const row = timesheets.find(t => t.id === id)
    if (row) pendingTimesheets.current.set(id, { ...row, ...patch })
    setTimesheets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }, [timesheets, pageScope, authEpoch])
  const removeTimesheet = useCallback((id: string) => {
    if (authEpoch !== authGeneration.current || currentScopeRef.current !== pageScope || !pageScope) return
    if (isTemporaryTimesheetId(id)) pendingTimesheets.current.delete(id)
    else pendingTimesheets.current.set(id, null)
    setTimesheets(prev => prev.filter(t => t.id !== id))
  }, [pageScope, authEpoch])
  const settleTimesheet = useCallback((id: string, committed = false) => {
    // Rejected writes do not change server truth and must not cancel another
    // mutation's refresh. Every committed settlement is followed by a fresh GET.
    if (authEpoch !== authGeneration.current || currentScopeRef.current !== pageScope || !pageScope) return
    if (pendingTimesheets.current.delete(id) && committed) pageReader.invalidate()
  }, [pageScope, pageReader, authEpoch])

  const fetchBackfillWindow = useCallback(() => readResource('backfill', () => dataClient.getBackfillWindow({ deduplicate: false }), setBackfillSettings), [readResource])
  const fetchDefaultLayouts = useCallback(() => readResource('layouts', () => dataClient.getDefaultLayouts({ deduplicate: false }), setDefaultLayouts), [readResource])

  const replaceSession = useCallback((next: ClientSessionUser | null) => {
    const generation = authHandoff.replace(next)
    authGeneration.current = generation
    sessionRef.current = next
    currentUserRef.current = next?.id
    profileRef.current = null
    profileSequence.current++
    setAuthEpoch(generation)
    todaySequence.current++
    pageReader.reset('', {})
    pendingTimesheets.current.clear()
    serverTimesheetOrder.current = []
    mutationLocks.clear()
    setBusyTimesheetIds(new Set())
    setUser(next)
    setProfile(null)
    setProjects([])
    setActivityTypes([])
    setTimesheets([])
    setAllUsers([])
    setSuperAdmin(false)
    setDefaultLayouts(null)
    setBackfillSettings(DEFAULT_BACKFILL)
    setResourceErrors({})
    setProfileError(null)
    setTodayPresence({ logged: false, loading: true, error: null })
    monthTotalsRequest.reset(next?.id ?? null)
    return generation
  }, [authHandoff, pageReader, mutationLocks, monthTotalsRequest])

  const fetchProfile = useCallback(async (userId: string) => {
    const generation = authGeneration.current
    const sequence = ++profileSequence.current
    let result: Awaited<ReturnType<typeof dataClient.getProfile>>
    try { result = await dataClient.getProfile(userId, { deduplicate: false }) }
    catch { result = { data: null, error: 'Could not load your profile.' } }
    if (generation !== authGeneration.current || sequence !== profileSequence.current) return
    const { data, error } = result
    if (error || !data) {
      setProfileError(error ?? 'Profile unavailable.')
      return
    }
    if (data.id !== userId || data.email !== sessionRef.current?.email) {
      setProfileError('Your account changed while loading. Please try again.')
      return
    }
    const previousProfile = profileRef.current
    if (previousProfile && !sameDashboardAuthorization(previousProfile, data)) replaceSession(sessionRef.current)
    else if (!previousProfile && data.is_active) monthTotalsRequest.reset(userId)
    profileRef.current = data
    setProfileError(null)
    setProfile(data)
    if (data.is_active) {
      const canSeeAll =
        data.permission_role === 'admin' ||
        data.permission_role === 'co' ||
        data.hierarchy_role === 'manager' ||
        data.hierarchy_role === 'team_lead'
      const tasks: Promise<unknown>[] = [
        fetchProjects(),
        fetchActivityTypes(),
        monthTotalsRequest.refresh(),
        fetchBackfillWindow(),
        fetchDefaultLayouts(),
      ]
      if (canSeeAll) tasks.push(fetchAllUsers())
      if (data.permission_role === 'admin') {
        tasks.push(readResource('capabilities', () => dataClient.getCapabilities({ deduplicate: false }), data => setSuperAdmin(data.isSuperAdmin)))
      }
      void Promise.all(tasks)
    }
  }, [fetchAllUsers, fetchBackfillWindow, fetchDefaultLayouts, fetchProjects, fetchActivityTypes, monthTotalsRequest, replaceSession, readResource])

  useEffect(() => {
    let mounted = true
    const activation = authHandoff.activate()
    const unsubscribe = authClient.onAuthStateChange(async (sessionUser, event) => {
      if (!mounted) return
      const decision = authHandoff.receive(sessionUser, event)
      if (decision === 'ignore' || decision === 'confirm') return
      if (activation.resumed && event === 'INITIAL_SESSION') {
        setAuthEpoch(activation.generation)
        monthTotalsRequest.reset(sessionUser?.id ?? null)
      }
      setIdentityError(null)
      const generation = decision === 'retain' ? authGeneration.current : replaceSession(sessionUser)
      if (sessionUser) {
        await fetchProfile(sessionUser.id)
      }
      if (generation === authGeneration.current) setLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
      authGeneration.current = authHandoff.dispose()
      // This is a request sequence, not a DOM ref; invalidate on teardown.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      todaySequence.current++
      pageReader.reset('', {})
      monthTotalsRequest.reset(null)
    }
  }, [fetchProfile, monthTotalsRequest, pageReader, replaceSession, authHandoff])

  useEffect(() => {
    if (!loading && !user && !identityError) router.replace('/')
  }, [loading, user, identityError, router])

  const handleLogout = async () => {
    setIdentityError(null)
    const generation = replaceSession(null)
    await authClient.signOut()
    if (generation === authGeneration.current && !sessionRef.current) router.replace('/')
  }

  const handleLogged = useCallback(async (optimistic?: OptimisticTimesheet) => {
    if (authEpoch !== authGeneration.current || currentScopeRef.current !== pageScope) return
    if (optimistic && (!entriesPage.user || entriesPage.user === user?.id)) {
      const entry: Timesheet = {
        id: optimistic.tempId,
        user_id: user?.id ?? '',
        project_id: optimistic.project_id,
        activity_type_id: optimistic.activity_type_id,
        entry_type: optimistic.entry_type, activity_code: optimistic.activity_code,
        ticket_number: optimistic.ticket_number, activity_other: optimistic.activity_other,
        projects: optimistic.project_id ? { name: projects.find(p => p.id === optimistic.project_id)?.name ?? '' } : null,
        log_date: optimistic.log_date,
        hours_worked: optimistic.hours_worked,
        work_done: optimistic.work_done,
        created_at: new Date().toISOString(),
      }
      pendingTimesheets.current.set(entry.id, entry)
      setTimesheets(prev => [entry, ...prev])
    }
    const ok = await refreshTimesheetData()
    if (authEpoch !== authGeneration.current || currentScopeRef.current !== pageScope) return
    // Settlement always drops the fake ID, including a failed/superseded read.
    if (optimistic) {
      pendingTimesheets.current.delete(optimistic.tempId)
      setTimesheets(prev => prev.filter(t => t.id !== optimistic.tempId))
    }
    return ok
  }, [refreshTimesheetData, user?.id, pageScope, entriesPage.user, authEpoch, projects])

  // --- panel (tile) customization ------------------------------------------------
  const [customizing, setCustomizing] = useState(false)
  const [customizeNonce, setCustomizeNonce] = useState(0)
  const savedLayout = profile?.dashboard_layout
  const dashDefault = useMemo(
    () => completeLayout(defaultLayouts?.dashboard, DEFAULT_DASHBOARD_LAYOUT),
    [defaultLayouts]
  )
  const activeLayout = useMemo(
    () => completeLayout(savedLayout, dashDefault),
    [savedLayout, dashDefault]
  )

  // Saved layout order (enabled only); any tile missing from the saved layout
  // (e.g. introduced by a later upgrade) falls back to its default position so
  // upgrades never hide tiles. Disabled tiles stay hidden.
  const orderedTiles = resolveLayout(activeLayout, dashDefault)

  const handleLayoutSave = (saved: typeof DEFAULT_DASHBOARD_LAYOUT) => {
    setProfile(p => (p ? { ...p, dashboard_layout: saved } : p))
    setCustomizing(false)
  }

  // --- admin-panel (tile) customization -----------------------------------------
  const [adminCustomizing, setAdminCustomizing] = useState(false)
  const [adminCustomizeNonce, setAdminCustomizeNonce] = useState(0)
  // The Super Admin tile is only offered to (and rendered for) the super admin;
  // everyone else gets the 12 regular admin tiles and never sees the option.
  const adminTileIds = useMemo<AdminTileId[]>(
    () => (superAdmin ? ADMIN_TILE_IDS : ADMIN_TILE_IDS.filter(id => id !== 'super-admin')),
    [superAdmin]
  )
  const adminDefaults = useMemo<AdminDashboardLayout>(() => {
    const base = completeLayout(defaultLayouts?.admin, DEFAULT_ADMIN_LAYOUT)
    const layout = { tiles: base.tiles.filter(t => adminTileIds.includes(t.id)) }
    // A genuine super admin must ALWAYS see the Super Admin panel. A saved
    // per-user or group default layout that omits/disables the tile must not
    // be allowed to hide these destructive controls — they are role-gated,
    // not layout-gated.
    return superAdmin ? forceTileEnabled(layout, 'super-admin') : layout
  }, [defaultLayouts, adminTileIds, superAdmin])
  const savedAdminLayout = profile?.admin_layout
  const savedAdminLayoutFiltered: AdminDashboardLayout | null = savedAdminLayout
    ? { tiles: savedAdminLayout.tiles.filter(t => adminTileIds.includes(t.id)) }
    : null
  const activeAdminLayout: AdminDashboardLayout = superAdmin
    ? forceTileEnabled(savedAdminLayoutFiltered ?? adminDefaults, 'super-admin')
    : savedAdminLayoutFiltered ?? adminDefaults
  const orderedAdminTiles = resolveLayout(activeAdminLayout, adminDefaults) as AdminTileId[]

  const handleAdminLayoutSave = (saved: AdminDashboardLayout) => {
    setProfile(p => (p ? { ...p, admin_layout: saved } : p))
    setAdminCustomizing(false)
  }

  const TILE_WIDTHS: Record<TileId, 'full' | 'half'> = {
    'entry-form': 'full', entries: 'full', leave: 'half', reminders: 'half',
    'global-reminders': 'half', telegram: 'half', profile: 'half',
  }

  /** Panels that should span the full row; the rest sit in the 2-col grid. */
  const ADMIN_TILE_WIDTHS: Record<AdminTileId, 'full' | 'half'> = {
    settings: 'half',
    'user-whitelist': 'full',
    hierarchy: 'full',
    'add-user': 'half',
    backfill: 'half',
    'activity-types': 'half',
    'global-reminders': 'half',
    'project-manager': 'half',
    'leave-admin': 'half',
    'report-export': 'half',
    import: 'half',
    backup: 'half',
    'super-admin': 'full',
  }

  const tileRegistry: Record<TileId, ReactNode> = {
    'entry-form': (
      <TimeEntryForm
        today={today}
        projects={projects}
        activityTypes={activityTypes}
        minLogDate={minLogDate}
        onLogged={handleLogged}
        collapsible
      />
    ),
    entries: (
      <EntriesTable
        today={today}
        timesheets={displayedTimesheets}
        pagination={entriesPage}
        totalCount={pageState.scope === pageScope ? pageState.count : null}
        loading={pageState.scope !== pageScope || pageState.loading}
        readError={pageState.scope === pageScope ? pageState.error : null}
        scope={pageScope}
        isSessionCurrent={isSessionCurrent}
        projects={projects}
        activityTypes={activityTypes}
        users={canSeeTeamEntries ? allUsers : []}
        userId={profile?.id ?? user?.id}
        isAdmin={isAdmin}
        canFilterByUser={canSeeTeamEntries}
        minLogDate={minLogDate}
        onChanged={refreshTimesheetData}
        onOptimisticInsert={insertTimesheet}
        onOptimisticUpdate={updateTimesheetRow}
        onOptimisticRemove={removeTimesheet}
        onOptimisticSettled={settleTimesheet}
        mutationLocks={mutationLocks}
        busyIds={busyTimesheetIds}
        onBusyChange={setTimesheetBusy}
        collapsible
      />
    ),
    leave: today ? <LeavePanel today={today} variant="own" userId={profile?.id || ''} /> : (
      <Card title="Leave"><p role="status" className="text-sm text-fg-muted">Preparing local calendar…</p></Card>
    ),
    reminders: <RemindersPanel userId={profile?.id || ''} />,
    'global-reminders': <GlobalRemindersPanel variant="own" />,
    profile: profile ? (
      <MyProfilePanel profile={profile} onSaved={() => fetchProfile(profile.id)} />
    ) : null,
    telegram: (
      <TelegramPanel
        key={authEpoch}
        projects={projects}
        activityTypes={activityTypes}
        userId={user?.id}
        isAdmin={isAdmin}
        revision={timesheetRevision}
      />
    ),
  }

  // Admin-panel tiles, registered only for roles that may see them.
  const adminTileRegistry: Partial<Record<AdminTileId, ReactNode>> = {
    ...(isAdmin
      ? {
          settings: <SettingsPanel value={backfillSettings} onSaved={setBackfillSettings} />,
          'user-whitelist': (
            <UserWhitelist key={authEpoch} isSessionCurrent={isSessionCurrent} allUsers={allUsers} selfId={user?.id} onChanged={fetchAllUsers} />
          ),
          hierarchy: <HierarchyEditor users={allUsers} onChanged={fetchAllUsers} />,
          'add-user': <AddUserForm users={allUsers} onChanged={fetchAllUsers} />,
          backfill: (
            <BackfillForm
              allUsers={allUsers}
              projects={projects}
              activityTypes={activityTypes}
              onChanged={refreshTimesheetData}
            />
          ),
          'activity-types': <ActivityTypesPanel />,
          'global-reminders': <GlobalRemindersPanel variant="admin" />,
          'leave-admin': today ? <LeavePanel today={today} variant="admin" userId={profile?.id || ''} users={allUsers} /> : (
            <Card title="Leave Management"><p role="status" className="text-sm text-fg-muted">Preparing local calendar…</p></Card>
          ),
          import: <ImportPanel onChanged={refreshTimesheetData} />,
          backup: <BackupPanel onChanged={refreshTimesheetData} />,
        }
      : {}),
    ...(canManageProjects ? { 'project-manager': <ProjectManager projects={projects} onChanged={fetchProjects} /> } : {}),
    ...(canGenerateReports
      ? { 'report-export': <ReportExport key={authEpoch} isSessionCurrent={isSessionCurrent} allUsers={allUsers} /> }
      : {}),
    ...(superAdmin
      ? {
          'super-admin': (
            <SuperAdminPanel
              users={allUsers}
              selfEmail={user?.email}
              defaultLayouts={defaultLayouts}
              onDefaultsChanged={(l) => setDefaultLayouts(l)}
              onChanged={() => {
                fetchProjects()
                fetchActivityTypes()
                refreshTimesheetData()
                fetchAllUsers()
                router.refresh()
              }}
            />
          ),
        }
      : {}),
  }

  // NAV-005: while the account is pending approval, poll the profile so the
  // user is admitted automatically the moment an admin activates the account
  // (no manual reload). The interval is torn down as soon as the account is no
  // longer pending (or the user signs out). A transient poll failure surfaces
  // the existing profile-error view with its Try again recovery.
  const accountView = classifyAccountView(profile, profileError)
  useEffect(() => {
    if (accountView !== 'pending' || !user) return
    const id = window.setInterval(() => {
      fetchProfile(user.id)
    }, 15000)
    return () => window.clearInterval(id)
  }, [accountView, user, fetchProfile])

  if (loading) return <LoadingState fullscreen />

  if (identityError) return (
    <div className="mx-auto my-16 max-w-md rounded-lg border border-border bg-card p-8 text-center">
      <h1 className="font-display text-xl font-semibold tracking-tight text-fg">Something went wrong</h1>
      <p className="mt-2 text-fg-muted">{identityError}</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>Try again</Button>
    </div>
  )

  if (!user) return null

  // PROFILE LOAD ERROR VIEW — a failed/missing profile must not be shown as
  // "pending approval"; offer a retry instead.
  if (accountView === 'error') {
    return (
      <AppShell
        email={user.email}
        role="user"
        active="dashboard"
        isActive={false}
        onLogout={handleLogout}
        centered
      >
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-500 dark:text-rose-300 ring-1 ring-inset ring-rose-200 dark:ring-rose-900">
            <IconAlert className="h-7 w-7" />
          </span>
          <h1 className="font-display text-xl font-semibold tracking-tight text-fg">Something went wrong</h1>
          <p className="mt-2 text-sm text-fg-muted">
            We couldn&apos;t load your profile. Please try again.
          </p>
          {profileError && <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">Error: {profileError}</p>}
          <Button onClick={() => fetchProfile(user.id)} className="mt-6 w-full">
            Try again
          </Button>
          <Button variant="secondary" onClick={handleLogout} className="mt-2 w-full">
            Logout
          </Button>
        </div>
      </AppShell>
    )
  }

  // PENDING APPROVAL VIEW
  if (accountView === 'pending') {
    return (
      <AppShell
        name={profile?.name}
        email={profile?.email}
        role="user"
        active="dashboard"
        isActive={false}
        onLogout={handleLogout}
        centered
      >
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-900">
            <IconAlert className="h-7 w-7" />
          </span>
          <h1 className="font-display text-xl font-semibold tracking-tight text-fg">Account Pending Approval</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {profile?.name ? `${profile.name}, your` : 'Your'} account is waiting for Admin
            activation. You&apos;ll be able to log time as soon as it&apos;s approved.
          </p>
          <Button variant="secondary" onClick={handleLogout} className="mt-6 w-full">
            Logout
          </Button>
        </div>
    </AppShell>
  )
}

  // AUTHORIZED VIEW
  return (
    <GlobalRemindersProvider key={`${user?.id}:${authEpoch}`} refreshKey={activeTab}>
    <AppShell
      name={profile?.name}
      email={profile?.email}
      department={profile?.department}
      role={role}
      active="dashboard"
      isActive={profile?.is_active === true}
      onLogout={handleLogout}
    >
      <PageHeader
        title={`Welcome back, ${profile?.name || profile?.email || ''}`}
        subtitle={
          profile?.department
            ? `${profile.department}${profile.title ? `, ${profile.title}` : ''}`
            : 'Track your time across projects.'
        }
      />

      {dataError && (
        <Alert tone="error" className="mb-6 flex items-start gap-2.5">
          <IconAlert className="mt-0.5 h-4.5 w-4.5 shrink-0" />
          <span>Error loading data: {dataError}</span>
        </Alert>
      )}

      <GlobalReminderBanners />

        {(showAdminPanel || canViewTeam) && (
          <SegmentedTabs
            value={activeTab}
            onChange={handleTabChange}
            options={[
              { key: 'user', label: 'My Timesheet', icon: <IconClock className="h-4 w-4" /> },
              ...(canViewTeam
                ? [{ key: 'team' as const, label: 'Team', icon: <IconUsers className="h-4 w-4" /> }]
                : []),
              ...(showAdminPanel
                ? [{ key: 'admin' as const, label: 'Admin Panel', icon: <IconUsers className="h-4 w-4" /> }]
                : []),
            ]}
            className="mb-6"
          />
        )}

      {/* TEAM VIEW */}
      {!isPending && activeTab === 'team' && canViewTeam && (
        <div className="mb-6">
          <TeamView
            users={allUsers}
            onSelectUser={(u) => {
              handleTabChange('user', u.id)
            }}
          />
        </div>
      )}

      {/* USER VIEW */}
      {isPending && activeTab === 'user' && (
        <SkeletonCard className="mb-6" lines={2} />
      )}
      {!isPending && activeTab === 'user' && (
        <>
          <section className="measure-in mb-6 overflow-hidden rounded-lg border border-border bg-card">
            <div aria-hidden className="h-0.5 bg-primary-600" />
            <div className="flex flex-wrap items-end gap-x-10 gap-y-5 p-5 sm:p-6" aria-live="polite">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-5xl font-semibold tabular-nums tracking-tight text-fg sm:text-6xl">
                    {monthTotals.status === 'ready' ? monthTotals.totals.totalHours : <span className="text-fg-subtle">—</span>}
                  </span>
                  <span className="font-display text-xl font-medium text-fg-muted">hrs</span>
                </div>
                <p className="mt-1.5 text-sm text-fg-muted">logged this month</p>
              </div>
              <div className="min-w-0">
                <span className="font-display text-3xl font-semibold tabular-nums tracking-tight text-fg">
                  {monthTotals.status === 'ready' ? monthTotals.totals.totalEntries : <span className="text-fg-subtle">—</span>}
                </span>
                <p className="mt-1.5 text-sm text-fg-muted">entries</p>
              </div>
              <div className="ml-auto self-center">
                {(() => {
                  const base = 'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset'
                  const dot = <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  if (todayPresence.loading) return <span className={`${base} bg-muted text-fg-muted ring-border`}>Checking today…</span>
                  if (todayPresence.error) return <span className={`${base} bg-muted text-fg-muted ring-border`}>Today unavailable</span>
                  if (todayPresence.logged) return <span className={`${base} bg-success-surface text-success-text ring-success-ring`}>{dot}Logged today</span>
                  return <span className={`${base} bg-warning-surface text-warning-text ring-warning-ring`}>{dot}Not logged yet</span>
                })()}
              </div>
            </div>
            {/* Ruler motif: a drafting measure echoing the sign-in rule. */}
            <div
              aria-hidden
              className="h-2.5 w-full border-b border-line"
              style={{
                backgroundImage: 'repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px 10px)',
                backgroundSize: '100% 10px',
                backgroundPosition: 'left bottom',
                backgroundRepeat: 'no-repeat',
              }}
            />
          </section>

          {todayPresence.error && <Alert tone="error" className="mb-6">{todayPresence.error} <Button variant="secondary" size="sm" onClick={() => void fetchToday()}>Retry today</Button></Alert>}

          {monthTotals.status === 'error' && (
            <Alert tone="error" className="mb-6">
              {monthTotals.error}{' '}
              <Button variant="secondary" size="sm" onClick={() => void monthTotalsRequest.refresh()}>Retry totals</Button>
            </Alert>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-fg-muted">Tiles can be customized below.</span>
            <Button variant="secondary" size="sm" onClick={() => { setCustomizeNonce(n => n + 1); setCustomizing(true) }}>
              Customize Panels
            </Button>
          </div>

          {customizing && (
            <PanelCustomizer
              key={customizeNonce}
              layout={activeLayout}
              labels={TILE_LABELS}
              defaultLayout={dashDefault}
              persist={dataClient.saveDashboardLayout}
              onSave={handleLayoutSave}
              onCancel={() => setCustomizing(false)}
            />
          )}

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {orderedTiles.map(tile => (
              <div key={tile} className={TILE_WIDTHS[tile as TileId] === 'full' ? 'lg:col-span-2' : undefined}>
                {tileRegistry[tile as TileId]}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ADMIN PANEL */}
      {isPending && activeTab === 'admin' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      )}
      {!isPending && activeTab === 'admin' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-fg-muted">Admin panels can be customized below.</span>
            <Button variant="secondary" size="sm" onClick={() => { setAdminCustomizeNonce(n => n + 1); setAdminCustomizing(true) }}>
              Customize Panels
            </Button>
          </div>

          {adminCustomizing && (
            <PanelCustomizer
              key={adminCustomizeNonce}
              layout={activeAdminLayout}
              labels={ADMIN_TILE_LABELS}
              defaultLayout={adminDefaults}
              persist={dataClient.saveAdminLayout}
              onSave={handleAdminLayoutSave}
              onCancel={() => setAdminCustomizing(false)}
            />
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {orderedAdminTiles.map(id => {
              const node = adminTileRegistry[id]
              if (!node) return null // tile not registered for this role
              const wide = ADMIN_TILE_WIDTHS[id] === 'full'
              return (
                <div key={id} className={wide ? 'lg:col-span-2' : undefined}>
                  {node}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </AppShell>
    </GlobalRemindersProvider>
  )
}

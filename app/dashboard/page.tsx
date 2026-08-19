// app/dashboard/page.tsx
// Dashboard: state + fetch orchestration. The forms, tables, and admin
// panels live in their own components under app/dashboard/.
'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useTransition, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient, type ClientSessionUser } from '@/lib/auth/client'
import { dataClient } from '@/lib/data/client'
import { amISuperAdmin, saveAdminLayout, saveDashboardLayout } from '../actions'
import { AdminDashboardLayout, AdminTileId, User, Project, Timesheet, ActivityType, TileId, OptimisticTimesheet } from '../types'
import { todayISO } from '@/lib/dates'
import { backfillMinDate, type BackfillSettings } from '@/lib/validation'
import { ADMIN_TILE_IDS, ADMIN_TILE_LABELS, DEFAULT_DASHBOARD_LAYOUT, TILE_LABELS } from '../constants'
import { resolveLayout } from '@/lib/layout'
import ProjectManager from './project-manager'
import LeavePanel from './leave-panel'
import RemindersPanel from './reminders-panel'
import GlobalRemindersPanel from './global-reminders-panel'
import SettingsPanel from './settings-panel'
import TimeEntryForm from './time-entry-form'
import EntriesTable from './entries-table'
import AddUserForm from './add-user-form'
import BackfillForm from './backfill-form'
import UserWhitelist from './user-whitelist'
import ReportExport from './report-export'
import ActivityTypesPanel from './activity-types-panel'
import MyProfilePanel from './my-profile-panel'
import TelegramPanel from './telegram-panel'
import PanelCustomizer from './panel-customizer'
import SuperAdminPanel from './super-admin-panel'
import ImportPanel from './import-panel'
import BackupPanel from './backup-panel'
import { AppShell, Button, PageHeader, SegmentedTabs, StatCard, SkeletonCard } from '@/app/components/ui'
import { IconAlert, IconCheck, IconClock, IconDocument, IconUsers } from '@/app/components/icons'

function monthPrefix(): string {
  // Local calendar month — UTC would report the previous month for the
  // first few hours of each month in timezones ahead of UTC.
  return todayISO().slice(0, 7)
}

const DEFAULT_BACKFILL: BackfillSettings = { mode: 'days', windowDays: 1, extraDays: 0 }

function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<ClientSessionUser | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([])
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [backfillSettings, setBackfillSettings] = useState<BackfillSettings>(DEFAULT_BACKFILL)
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [superAdmin, setSuperAdmin] = useState(false)
  // Monotonic counter so a stale in-flight getTimesheets() response can never
  // clobber a newer one (e.g. the optimistic insert in handleLogged).
  const fetchSeqRef = useRef(0)

  const searchParams = useSearchParams()
  const role = profile?.role ?? 'user'
  const isAdmin = role === 'admin'
  const canManageProjects = isAdmin || role === 'pm'
  const canGenerateReports = isAdmin || role === 'co'
  // Admins/COs see all entries; managers and team leads see their team. All of
  // them can pick whose entries are visible at a time.
  const canSeeTeamEntries = isAdmin || role === 'co' || role === 'manager' || role === 'team_lead'
  const showAdminPanel = isAdmin || canManageProjects || canGenerateReports

  // Read activeTab from URL (SSR-safe via useSearchParams), but clamp to 'user'
  // when the admin panel is not visible for this role.
  const urlTab = searchParams?.get('tab') === 'admin' ? 'admin' : 'user'
  const effectiveTab = showAdminPanel ? urlTab : 'user'
  const [activeTab, setActiveTab] = useState<'user' | 'admin'>(effectiveTab)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab(effectiveTab)
  }, [effectiveTab])

  const handleTabChange = (tab: 'user' | 'admin') => {
    startTransition(() => {
      setActiveTab(tab)
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('tab', tab)
      router.replace(`?${params.toString()}`)
    })
  }

  // Backfill window: the earliest date regular users may log or edit.
  const today = todayISO()
  const minLogDate = backfillMinDate(today, backfillSettings)

  const fetchProjects = useCallback(async () => {
    const { data, error } = await dataClient.getProjects()
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) setProjects(data)
  }, [])

  const fetchActivityTypes = useCallback(async () => {
    const { data, error } = await dataClient.getActivityTypes()
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) setActivityTypes(data)
  }, [])

  const fetchTimesheets = useCallback(async () => {
    // RLS (supabase) or server-side scoping (native): users only get their
    // own; admins and COs get all (for reports).
    const seq = ++fetchSeqRef.current
    const { data, error } = await dataClient.getTimesheets()
    if (error) {
      setDataError(error)
      return false
    }
    setDataError(null)
    if (seq === fetchSeqRef.current && data) setTimesheets(data)
    return seq === fetchSeqRef.current
  }, [])

  const fetchAllUsers = useCallback(async () => {
    const { data, error } = await dataClient.getAllUsers()
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) setAllUsers(data)
  }, [])

  const fetchBackfillWindow = useCallback(async () => {
    const { data } = await dataClient.getBackfillWindow()
    if (data) setBackfillSettings(data)
  }, [])

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await dataClient.getProfile(userId)
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) {
      setProfile(data)
      if (data.is_active) {
        fetchProjects()
        fetchActivityTypes()
        fetchTimesheets()
        // Admin/CO see all profiles; managers and team leads see their team.
        if (data.role === 'admin' || data.role === 'co' || data.role === 'manager' || data.role === 'team_lead') {
          fetchAllUsers()
        }
        fetchBackfillWindow()
        if (data.role === 'admin') {
          amISuperAdmin().then(({ isSuperAdmin }) => setSuperAdmin(isSuperAdmin))
        }
      }
    }
  }, [fetchAllUsers, fetchBackfillWindow, fetchProjects, fetchActivityTypes, fetchTimesheets])

  useEffect(() => {
    const unsubscribe = authClient.onAuthStateChange(async (sessionUser) => {
      if (sessionUser) {
        setUser(sessionUser)
        await fetchProfile(sessionUser.id)
      } else {
        setUser(null)
        setProfile(null)
        setProjects([])
        setTimesheets([])
        setAllUsers([])
        setDataError(null)
      }
      setLoading(false)
    })

    return unsubscribe
  }, [fetchProfile])

  useEffect(() => {
    if (!loading && !user) router.replace('/')
  }, [loading, user, router])

  const handleLogout = async () => {
    await authClient.signOut()
    setUser(null)
    setProfile(null)
    setTimesheets([])
    setProjects([])
    setAllUsers([])
    setDataError(null)
    router.replace('/')
  }

  const handleLogged = useCallback(async (optimistic?: OptimisticTimesheet) => {
    if (optimistic) {
      const entry: Timesheet = {
        id: optimistic.tempId,
        user_id: user?.id ?? '',
        project_id: optimistic.project_id,
        activity_type_id: optimistic.activity_type_id,
        log_date: optimistic.log_date,
        hours_worked: optimistic.hours_worked,
        work_done: optimistic.work_done,
        created_at: new Date().toISOString(),
      }
      setTimesheets(prev => [entry, ...prev])
    }
    const ok = await fetchTimesheets()
    // If the refetch failed, drop the optimistic fake-id row so Edit/Delete
    // never attempt to target a non-existent server row.
    if (!ok && optimistic) {
      setTimesheets(prev => prev.filter(t => t.id !== optimistic.tempId))
    }
  }, [fetchTimesheets, user?.id])

  // Quick stats (this month)
  const monthStats = useMemo(() => {
    const prefix = monthPrefix()
    const monthRows = timesheets.filter(t => t.log_date.startsWith(prefix))
    const hours = monthRows.reduce((acc, t) => acc + (Number(t.hours_worked) || 0), 0)
    const today = todayISO()
    const loggedToday = timesheets.some(t => t.user_id === user?.id && t.log_date === today)
    return { hours, count: monthRows.length, loggedToday }
  }, [timesheets, user])

  // --- panel (tile) customization ------------------------------------------------
  const [customizing, setCustomizing] = useState(false)
  const [customizeNonce, setCustomizeNonce] = useState(0)
  const savedLayout = profile?.dashboard_layout
  const activeLayout = savedLayout ?? DEFAULT_DASHBOARD_LAYOUT

  // Saved layout order (enabled only); any tile missing from the saved layout
  // (e.g. introduced by a later upgrade) falls back to its default position so
  // upgrades never hide tiles. Disabled tiles stay hidden.
  const orderedTiles = resolveLayout(activeLayout, DEFAULT_DASHBOARD_LAYOUT)

  const handleLayoutSave = (saved: typeof DEFAULT_DASHBOARD_LAYOUT) => {
    setProfile(p => (p ? { ...p, dashboard_layout: saved } : p))
    setCustomizing(false)
  }

  // --- admin-panel (tile) customization -----------------------------------------
  const [adminCustomizing, setAdminCustomizing] = useState(false)
  const [adminCustomizeNonce, setAdminCustomizeNonce] = useState(0)
  // The Super Admin tile is only offered to (and rendered for) the super admin;
  // everyone else gets the 11 regular admin tiles and never sees the option.
  const adminTileIds = useMemo<AdminTileId[]>(
    () => (superAdmin ? ADMIN_TILE_IDS : ADMIN_TILE_IDS.filter(id => id !== 'super-admin')),
    [superAdmin]
  )
  const adminDefaults = useMemo<AdminDashboardLayout>(
    () => ({ tiles: adminTileIds.map(id => ({ id, enabled: true })) }),
    [adminTileIds]
  )
  const savedAdminLayout = profile?.admin_layout
  const activeAdminLayout: AdminDashboardLayout = savedAdminLayout
    ? { tiles: savedAdminLayout.tiles.filter(t => adminTileIds.includes(t.id)) }
    : adminDefaults
  const orderedAdminTiles = resolveLayout(activeAdminLayout, adminDefaults) as AdminTileId[]

  const handleAdminLayoutSave = (saved: AdminDashboardLayout) => {
    setProfile(p => (p ? { ...p, admin_layout: saved } : p))
    setAdminCustomizing(false)
  }

  /** Panels that should span the full row; the rest sit in the 2-col grid. */
  const ADMIN_TILE_WIDTHS: Record<AdminTileId, 'full' | 'half'> = {
    settings: 'half',
    'user-whitelist': 'full',
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
        projects={projects}
        activityTypes={activityTypes}
        minLogDate={minLogDate}
        onLogged={handleLogged}
        collapsible
      />
    ),
    entries: (
      <EntriesTable
        timesheets={timesheets}
        projects={projects}
        activityTypes={activityTypes}
        users={canSeeTeamEntries ? allUsers : []}
        userId={user?.id}
        isAdmin={isAdmin}
        canFilterByUser={canSeeTeamEntries}
        minLogDate={minLogDate}
        onChanged={fetchTimesheets}
        collapsible
      />
    ),
    leave: <LeavePanel variant="own" userId={profile?.id || ''} />,
    reminders: <RemindersPanel userId={profile?.id || ''} />,
    'global-reminders': <GlobalRemindersPanel variant="own" />,
    profile: profile ? (
      <MyProfilePanel profile={profile} onSaved={() => fetchProfile(profile.id)} />
    ) : null,
    telegram: (
      <TelegramPanel
        timesheets={timesheets}
        projects={projects}
        activityTypes={activityTypes}
        userId={user?.id}
        isAdmin={isAdmin}
      />
    ),
  }

  // Admin-panel tiles, registered only for roles that may see them.
  const adminTileRegistry: Partial<Record<AdminTileId, ReactNode>> = {
    ...(isAdmin
      ? {
          settings: <SettingsPanel value={backfillSettings} onSaved={setBackfillSettings} />,
          'user-whitelist': (
            <UserWhitelist allUsers={allUsers} selfId={user?.id} onChanged={fetchAllUsers} />
          ),
          'add-user': <AddUserForm users={allUsers} onChanged={fetchAllUsers} />,
          backfill: (
            <BackfillForm
              allUsers={allUsers}
              projects={projects}
              activityTypes={activityTypes}
              onChanged={fetchTimesheets}
            />
          ),
          'activity-types': <ActivityTypesPanel />,
          'global-reminders': <GlobalRemindersPanel variant="admin" />,
          'leave-admin': <LeavePanel variant="admin" userId={profile?.id || ''} users={allUsers} />,
          import: <ImportPanel onChanged={fetchTimesheets} />,
          backup: <BackupPanel onChanged={fetchTimesheets} />,
        }
      : {}),
    ...(canManageProjects ? { 'project-manager': <ProjectManager projects={projects} onChanged={fetchProjects} /> } : {}),
    ...(canGenerateReports
      ? { 'report-export': <ReportExport allUsers={allUsers} timesheets={timesheets} /> }
      : {}),
    ...(superAdmin
      ? {
          'super-admin': (
            <SuperAdminPanel
              users={allUsers}
              onChanged={() => {
                fetchProjects()
                fetchActivityTypes()
                fetchTimesheets()
                fetchAllUsers()
              }}
            />
          ),
        }
      : {}),
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
        Loading…
      </div>
    </div>
  )

  if (!user) return null

  // PENDING APPROVAL VIEW
  if (user && (!profile || !profile.is_active)) {
    return (
      <AppShell
        name={profile?.name}
        email={profile?.email}
        role="user"
        active="dashboard"
        onLogout={handleLogout}
        centered
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-500 ring-1 ring-inset ring-amber-200">
            <IconAlert className="h-7 w-7" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Account Pending Approval</h1>
          <p className="mt-2 text-sm text-slate-500">
            {profile?.name ? `${profile.name}, your` : 'Your'} account is waiting for Admin
            activation. You&apos;ll be able to log time as soon as it&apos;s approved.
          </p>
          {dataError && <p className="mt-4 text-sm text-rose-600">Error: {dataError}</p>}
          <Button variant="secondary" onClick={handleLogout} className="mt-6 w-full">
            Logout
          </Button>
        </div>
    </AppShell>
  )
}

  // AUTHORIZED VIEW
  return (
    <AppShell
      name={profile?.name}
      email={profile?.email}
      department={profile?.department}
      role={role}
      active="dashboard"
      onLogout={handleLogout}
    >
      <PageHeader
        title={`Welcome back, ${profile?.name || profile?.email || ''}`}
        subtitle={
          profile?.department
            ? `${profile.department}${profile.title ? ` · ${profile.title}` : ''}`
            : 'Track your time across projects.'
        }
      />

      {dataError && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <IconAlert className="mt-0.5 h-4.5 w-4.5 shrink-0" />
          <span>Error loading data: {dataError}</span>
        </div>
      )}

        {showAdminPanel && (
          <SegmentedTabs
            value={activeTab}
            onChange={handleTabChange}
            options={[
              { key: 'user', label: 'My Timesheet', icon: <IconClock className="h-4 w-4" /> },
              { key: 'admin', label: 'Admin Panel', icon: <IconUsers className="h-4 w-4" /> },
            ]}
            className="mb-6"
          />
        )}

      {/* USER VIEW */}
      {isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}
      {!isPending && activeTab === 'user' && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Hours · this month" value={monthStats.hours} icon={<IconClock className="h-5 w-5" />} />
            <StatCard label="Entries · this month" value={monthStats.count} icon={<IconDocument className="h-5 w-5" />} accent="blue" />
            <StatCard
              label="Today"
              value={monthStats.loggedToday ? 'Logged' : 'Not yet'}
              icon={<IconCheck className="h-5 w-5" />}
              accent={monthStats.loggedToday ? 'green' : 'amber'}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">Tiles can be customized below.</span>
            <Button variant="secondary" size="sm" onClick={() => { setCustomizeNonce(n => n + 1); setCustomizing(true) }}>
              Customize Panels
            </Button>
          </div>

          {customizing && (
            <PanelCustomizer
              key={customizeNonce}
              layout={activeLayout}
              labels={TILE_LABELS}
              defaultLayout={DEFAULT_DASHBOARD_LAYOUT}
              persist={saveDashboardLayout}
              onSave={handleLayoutSave}
              onCancel={() => setCustomizing(false)}
            />
          )}

          {orderedTiles.map(tile => (
            <div key={tile} className="mt-6">
              {tileRegistry[tile as TileId]}
            </div>
          ))}
        </>
      )}

      {/* ADMIN PANEL */}
      {isPending && (
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
            <span className="text-xs text-slate-400">Admin panels can be customized below.</span>
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
              persist={saveAdminLayout}
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
  )
}

function DashboardPageWithSuspense() {
  return (
    <Suspense fallback={null}>
      <DashboardPage />
    </Suspense>
  )
}

export default DashboardPageWithSuspense

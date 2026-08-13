// app/dashboard/page.tsx
// Dashboard: state + fetch orchestration. The forms, tables, and admin
// panels live in their own components under app/dashboard/.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { User, Project, Timesheet } from '../types'
import { addDaysISO, todayISO } from '@/lib/dates'
import ProjectManager from './project-manager'
import LeavePanel from './leave-panel'
import RemindersPanel from './reminders-panel'
import SettingsPanel from './settings-panel'
import TimeEntryForm from './time-entry-form'
import EntriesTable from './entries-table'
import AddUserForm from './add-user-form'
import BackfillForm from './backfill-form'
import UserWhitelist from './user-whitelist'
import ReportExport from './report-export'
import { AppShell, Button, PageHeader, SegmentedTabs, StatCard } from '@/app/components/ui'
import { IconAlert, IconCheck, IconClock, IconDocument, IconUsers } from '@/app/components/icons'

const supabase = createClient()

function monthPrefix(): string {
  return new Date().toISOString().slice(0, 7)
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [backfillWindow, setBackfillWindow] = useState(1)
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'user' | 'admin'>('user')

  const role = profile?.role ?? 'user'
  const isAdmin = role === 'admin'
  const canManageProjects = isAdmin || role === 'pm'
  const canGenerateReports = isAdmin || role === 'co'
  const showAdminPanel = isAdmin || canManageProjects || canGenerateReports

  // Backfill window: the earliest date regular users may log or edit.
  const today = todayISO()
  const minLogDate = addDaysISO(today, -backfillWindow)
  const yesterdayWritable = backfillWindow >= 1

  const fetchProjects = useCallback(async () => {
    const { data, error } = await supabase.from('projects').select('*')
    if (error) { setDataError(error.message); return }
    setDataError(null)
    if (data) setProjects(data)
  }, [])

  const fetchTimesheets = useCallback(async () => {
    // RLS: users only get their own; admins and COs get all (for reports).
    const { data, error } = await supabase
      .from('timesheets')
      .select('*, projects(name), profiles(email)')
      .order('log_date', { ascending: false })
    if (error) { setDataError(error.message); return }
    setDataError(null)
    if (data) setTimesheets(data)
  }, [])

  const fetchAllUsers = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').limit(500)
    if (error) { setDataError(error.message); return }
    setDataError(null)
    if (data) setAllUsers(data)
  }, [])

  const fetchBackfillWindow = useCallback(async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('backfill_window_days')
      .eq('id', 1)
      .limit(1)
      .maybeSingle()
    if (data && typeof data.backfill_window_days === 'number' && data.backfill_window_days >= 0) {
      setBackfillWindow(data.backfill_window_days)
    }
  }, [])

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) { setDataError(error.message); return }
    setDataError(null)
    if (data) {
      setProfile(data as User)
      if (data.is_active) {
        fetchProjects()
        fetchTimesheets()
        if (data.role === 'admin' || data.role === 'co') fetchAllUsers()
        fetchBackfillWindow()
      }
    }
  }, [fetchAllUsers, fetchBackfillWindow, fetchProjects, fetchTimesheets])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        if (session) {
          setUser(session.user as unknown as User)
          await fetchProfile(session.user.id)
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        setProjects([])
        setTimesheets([])
        setAllUsers([])
        setDataError(null)
        router.replace('/')
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile, router])

  useEffect(() => {
    if (!loading && !user) router.replace('/')
  }, [loading, user, router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setTimesheets([])
  }

  // Quick stats (this month)
  const monthStats = useMemo(() => {
    const prefix = monthPrefix()
    const monthRows = timesheets.filter(t => t.log_date.startsWith(prefix))
    const hours = monthRows.reduce((acc, t) => acc + (Number(t.hours_worked) || 0), 0)
    const today = new Date().toISOString().split('T')[0]
    const loggedToday = timesheets.some(t => t.user_id === user?.id && t.log_date === today)
    return { hours, count: monthRows.length, loggedToday }
  }, [timesheets, user])

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
          onChange={setActiveTab}
          options={[
            { key: 'user', label: 'My Timesheet', icon: <IconClock className="h-4 w-4" /> },
            { key: 'admin', label: 'Admin Panel', icon: <IconUsers className="h-4 w-4" /> },
          ]}
          className="mb-6"
        />
      )}

      {/* USER VIEW */}
      {activeTab === 'user' && (
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

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <TimeEntryForm
              projects={projects}
              backfillWindow={backfillWindow}
              minLogDate={minLogDate}
              yesterdayWritable={yesterdayWritable}
              onLogged={fetchTimesheets}
            />
            <EntriesTable
              timesheets={timesheets}
              projects={projects}
              userId={user?.id}
              isAdmin={isAdmin}
              minLogDate={minLogDate}
              onChanged={fetchTimesheets}
            />
          </div>

          {/* Leave + Reminders (all users) */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <LeavePanel variant="own" userId={profile?.id || ''} />
            <RemindersPanel userId={profile?.id || ''} />
          </div>
        </>
      )}

      {/* ADMIN PANEL */}
      {activeTab === 'admin' && (
        <div className="space-y-6">
          {isAdmin && <SettingsPanel value={backfillWindow} onSaved={setBackfillWindow} />}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {isAdmin && <AddUserForm onChanged={fetchAllUsers} />}
            {isAdmin && <BackfillForm allUsers={allUsers} projects={projects} onChanged={fetchTimesheets} />}
          </div>

          {isAdmin && <UserWhitelist allUsers={allUsers} selfId={user?.id} onChanged={fetchAllUsers} />}

          {canManageProjects && <ProjectManager projects={projects} onChanged={fetchProjects} />}

          {isAdmin && <LeavePanel variant="admin" userId={profile?.id || ''} users={allUsers} />}

          {canGenerateReports && <ReportExport allUsers={allUsers} timesheets={timesheets} />}
        </div>
      )}
    </AppShell>
  )
}

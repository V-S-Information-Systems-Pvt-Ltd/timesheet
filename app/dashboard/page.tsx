// app/dashboard/page.tsx
// Dashboard: state + fetch orchestration. The forms, tables, and admin
// panels live in their own components under app/dashboard/.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient, type ClientSessionUser } from '@/lib/auth/client'
import { dataClient } from '@/lib/data/client'
import { User, Project, Timesheet, ActivityType } from '../types'
import { addDaysISO, todayISO } from '@/lib/dates'
import { backfillMinDate, type BackfillSettings } from '@/lib/validation'
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
import { AppShell, Button, PageHeader, SegmentedTabs, StatCard } from '@/app/components/ui'
import { IconAlert, IconCheck, IconClock, IconDocument, IconUsers } from '@/app/components/icons'

function monthPrefix(): string {
  // Local calendar month — UTC would report the previous month for the
  // first few hours of each month in timezones ahead of UTC.
  return todayISO().slice(0, 7)
}

const DEFAULT_BACKFILL: BackfillSettings = { mode: 'days', windowDays: 1, extraDays: 0 }

export default function DashboardPage() {
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
  const [activeTab, setActiveTab] = useState<'user' | 'admin'>('user')

  const role = profile?.role ?? 'user'
  const isAdmin = role === 'admin'
  const canManageProjects = isAdmin || role === 'pm'
  const canGenerateReports = isAdmin || role === 'co'
  const showAdminPanel = isAdmin || canManageProjects || canGenerateReports

  // Backfill window: the earliest date regular users may log or edit.
  const today = todayISO()
  const minLogDate = backfillMinDate(today, backfillSettings)
  const yesterdayWritable = addDaysISO(today, -1) >= minLogDate

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
    const { data, error } = await dataClient.getTimesheets()
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) setTimesheets(data)
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
        if (data.role === 'admin' || data.role === 'co') fetchAllUsers()
        fetchBackfillWindow()
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

  // Quick stats (this month)
  const monthStats = useMemo(() => {
    const prefix = monthPrefix()
    const monthRows = timesheets.filter(t => t.log_date.startsWith(prefix))
    const hours = monthRows.reduce((acc, t) => acc + (Number(t.hours_worked) || 0), 0)
    const today = todayISO()
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
              activityTypes={activityTypes}
              minLogDate={minLogDate}
              yesterdayWritable={yesterdayWritable}
              onLogged={fetchTimesheets}
            />
            <EntriesTable
              timesheets={timesheets}
              projects={projects}
              activityTypes={activityTypes}
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

          {/* Global reminders + profile */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GlobalRemindersPanel variant="own" />
            {profile && <MyProfilePanel profile={profile} onSaved={() => fetchProfile(profile.id)} />}
          </div>

          {/* Telegram bot command mirror (runs in parallel with the bot) */}
          <div className="mt-6">
            <TelegramPanel
              timesheets={timesheets}
              projects={projects}
              activityTypes={activityTypes}
              userId={user?.id}
              isAdmin={isAdmin}
            />
          </div>
        </>
      )}

      {/* ADMIN PANEL */}
      {activeTab === 'admin' && (
        <div className="space-y-6">
          {isAdmin && <SettingsPanel value={backfillSettings} onSaved={setBackfillSettings} />}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {isAdmin && <AddUserForm onChanged={fetchAllUsers} />}
            {isAdmin && <BackfillForm allUsers={allUsers} projects={projects} activityTypes={activityTypes} onChanged={fetchTimesheets} />}
          </div>

          {isAdmin && <ActivityTypesPanel />}

          {isAdmin && <GlobalRemindersPanel variant="admin" />}

          {isAdmin && <UserWhitelist allUsers={allUsers} selfId={user?.id} onChanged={fetchAllUsers} />}

          {canManageProjects && <ProjectManager projects={projects} onChanged={fetchProjects} />}

          {isAdmin && <LeavePanel variant="admin" userId={profile?.id || ''} users={allUsers} />}

          {canGenerateReports && <ReportExport allUsers={allUsers} timesheets={timesheets} />}
        </div>
      )}
    </AppShell>
  )
}

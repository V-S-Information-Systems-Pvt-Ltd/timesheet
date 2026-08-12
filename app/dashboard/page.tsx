// app/dashboard/page.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  addUser,
  deleteLastEntry,
  deleteTimesheet,
  logEntry,
  logYesterday,
  toggleUserStatus,
  updateTimesheet,
  updateUserRole,
} from '../actions'
import { User, Project, Timesheet, UserRole } from '../types'
import ProjectManager from './project-manager'
import LeavePanel from './leave-panel'
import RemindersPanel from './reminders-panel'
import SettingsPanel from './settings-panel'
import { addDaysISO, todayISO } from '@/lib/dates'
import { downloadCSV } from '@/lib/csv'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconAlert,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconDocument,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
  Input,
  PageHeader,
  RoleBadge,
  SegmentedTabs,
  Select,
  StatCard,
  Td,
  Textarea,
  Th,
  toast,
} from '@/app/components/ui'

const supabase = createClient()

const ROLES: UserRole[] = ['admin', 'pm', 'co', 'user']

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

  // Form states
  const [activeTab, setActiveTab] = useState<'user' | 'admin'>('user')
  const [projectId, setProjectId] = useState('')
  const [hours, setHours] = useState('')
  const [workDone, setWorkDone] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [reportUser, setReportUser] = useState('all')
  const [reportStartDate, setReportStartDate] = useState('')
  const [reportEndDate, setReportEndDate] = useState('')

  // Log-yesterday states
  const [showYesterday, setShowYesterday] = useState(false)
  const [yesterdayProjectId, setYesterdayProjectId] = useState('')
  const [yesterdayHours, setYesterdayHours] = useState('')
  const [yesterdayWorkDone, setYesterdayWorkDone] = useState('')

  // Admin backfill-yesterday states
  const [backfillUserId, setBackfillUserId] = useState('')
  const [backfillProjectId, setBackfillProjectId] = useState('')
  const [backfillHours, setBackfillHours] = useState('')
  const [backfillWorkDone, setBackfillWorkDone] = useState('')

  // Add-user form (admin only)
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserDepartment, setNewUserDepartment] = useState('')
  const [newUserTitle, setNewUserTitle] = useState('')
  const [newUserRole, setNewUserRole] = useState<UserRole>('user')
  const [newUserActive, setNewUserActive] = useState(true)

  // Edit-entry state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editProjectId, setEditProjectId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editWorkDone, setEditWorkDone] = useState('')
  const [editLogDate, setEditLogDate] = useState('')

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

  const handleLogEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await logEntry({
      projectId,
      hoursWorked: parseFloat(hours),
      workDone,
      logDate,
    })
    if (error) toast(error, 'error')
    else {
      setHours(''); setWorkDone('')
      fetchTimesheets()
      toast('Time logged successfully!', 'success')
    }
  }

  const handleLogYesterday = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await logYesterday({
      projectId: yesterdayProjectId,
      hoursWorked: parseFloat(yesterdayHours),
      workDone: yesterdayWorkDone,
    })
    if (error) toast(error, 'error')
    else {
      setYesterdayProjectId('')
      setYesterdayHours('')
      setYesterdayWorkDone('')
      fetchTimesheets()
      toast('Logged for yesterday!', 'success')
    }
  }

  const handleAdminBackfill = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await logYesterday({
      projectId: backfillProjectId,
      hoursWorked: parseFloat(backfillHours),
      workDone: backfillWorkDone,
      userId: backfillUserId,
    })
    if (error) toast(error, 'error')
    else {
      setBackfillUserId('')
      setBackfillProjectId('')
      setBackfillHours('')
      setBackfillWorkDone('')
      fetchTimesheets()
      toast('Backfill saved!', 'success')
    }
  }

  const handleUndoLast = async () => {
    if (!confirm('Delete your most recent entry?')) return
    const { error } = await deleteLastEntry()
    if (error) toast(error, 'error')
    else {
      fetchTimesheets()
      toast('Most recent entry deleted.', 'success')
    }
  }

  const handleEditLast = () => {
    if (timesheets.length === 0) return toast('No entries to edit.', 'info')
    startEdit(timesheets[0])
  }

  const startEdit = (t: Timesheet) => {
    setEditingId(t.id)
    setEditProjectId(t.project_id)
    setEditHours(String(t.hours_worked))
    setEditWorkDone(t.work_done)
    setEditLogDate(t.log_date)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditProjectId('')
    setEditHours('')
    setEditWorkDone('')
    setEditLogDate('')
  }

  const handleUpdateEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    const { error } = await updateTimesheet(editingId, {
      projectId: editProjectId,
      hoursWorked: parseFloat(editHours),
      workDone: editWorkDone,
      logDate: editLogDate,
    })
    if (error) toast(error, 'error')
    else {
      cancelEdit()
      fetchTimesheets()
      toast('Entry updated successfully!', 'success')
    }
  }

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return
    const { error } = await deleteTimesheet(entryId)
    if (error) toast(error, 'error')
    else {
      if (editingId === entryId) cancelEdit()
      fetchTimesheets()
      toast('Entry deleted.', 'success')
    }
  }

  const handleToggleUserStatus = async (userId: string) => {
    const { error } = await toggleUserStatus(userId)
    if (error) toast(error, 'error')
    else {
      fetchAllUsers()
      toast('User status updated.', 'success')
    }
  }

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const { error } = await updateUserRole(userId, newRole)
    if (error) toast(error, 'error')
    else {
      fetchAllUsers()
      toast('Role updated.', 'success')
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await addUser({
      name: newUserName,
      email: newUserEmail,
      password: newUserPassword,
      department: newUserDepartment,
      title: newUserTitle,
      role: newUserRole,
      isActive: newUserActive,
    })
    if (error) toast(error, 'error')
    else {
      setNewUserName('')
      setNewUserEmail('')
      setNewUserPassword('')
      setNewUserDepartment('')
      setNewUserTitle('')
      setNewUserRole('user')
      setNewUserActive(true)
      fetchAllUsers()
      toast('User added successfully!', 'success')
    }
  }

  const generateReport = () => {
    let dataToExport = timesheets

    if (reportStartDate) dataToExport = dataToExport.filter(t => t.log_date >= reportStartDate)
    if (reportEndDate) dataToExport = dataToExport.filter(t => t.log_date <= reportEndDate)
    if (reportUser !== 'all') dataToExport = dataToExport.filter(t => t.user_id === reportUser)

    if (dataToExport.length === 0) return toast('No data found for selected criteria.', 'info')

    const headers = ['Date', 'User', 'Project', 'Hours', 'Work Done']
    const rows = dataToExport.map(t => [
      t.log_date,
      t.profiles?.email || 'Unknown',
      t.projects?.name || 'Unknown',
      t.hours_worked,
      t.work_done,
    ])

    downloadCSV(`report_${new Date().getTime()}.csv`, headers, rows)
    toast('Report exported.', 'success')
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
            {/* Log Form */}
            <Card
              title="Log Time"
              subtitle={`Writable dates: last ${backfillWindow} day${backfillWindow === 1 ? '' : 's'} (today included)`}
              icon={<IconClock className="h-4.5 w-4.5" />}
            >
              <form onSubmit={handleLogEntry} className="space-y-4">
                <Field label="Project">
                  <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
                    <option value="">Select Project…</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date">
                    <Input type="date" min={minLogDate} value={logDate} onChange={(e) => setLogDate(e.target.value)} required />
                  </Field>
                  <Field label="Hours">
                    <Input
                      type="number"
                      step="0.25"
                      min="0"
                      placeholder="8.0"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                      required
                    />
                  </Field>
                </div>
                <Field label="Work Done">
                  <Textarea
                    placeholder="What did you work on?"
                    value={workDone}
                    onChange={(e) => setWorkDone(e.target.value)}
                    required
                    className="h-24"
                  />
                </Field>
                <Button type="submit" className="w-full py-2.5">
                  Submit Entry
                </Button>
              </form>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowYesterday(!showYesterday)}
                  disabled={!yesterdayWritable}
                  title={yesterdayWritable ? undefined : 'Backfill window is 0 days — only today can be logged'}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-primary-600 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Log Yesterday (within {backfillWindow} day window)</span>
                  <IconChevronDown className={`h-4 w-4 transition-transform ${showYesterday ? 'rotate-180' : ''}`} />
                </button>
                {showYesterday && (
                  <form onSubmit={handleLogYesterday} className="mt-2 space-y-3">
                    <Field label="Project">
                      <Select value={yesterdayProjectId} onChange={(e) => setYesterdayProjectId(e.target.value)} required>
                        <option value="">Select Project…</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Hours">
                        <Input
                          type="number"
                          step="0.25"
                          min="0"
                          placeholder="8.0"
                          value={yesterdayHours}
                          onChange={(e) => setYesterdayHours(e.target.value)}
                          required
                        />
                      </Field>
                      <Field label="Work Done">
                        <Input
                          type="text"
                          placeholder="Summary"
                          value={yesterdayWorkDone}
                          onChange={(e) => setYesterdayWorkDone(e.target.value)}
                          required
                        />
                      </Field>
                    </div>
                    <Button type="submit" variant="secondary" className="w-full">
                      Save Yesterday
                    </Button>
                  </form>
                )}
              </div>
            </Card>

            {/* User's Records */}
            <Card
              title="My Recent Entries"
              subtitle={`${timesheets.length} entr${timesheets.length === 1 ? 'y' : 'ies'}`}
              icon={<IconDocument className="h-4.5 w-4.5" />}
              className="md:col-span-2"
              bodyClassName="p-0"
              actions={
                <>
                  <Button variant="ghost" size="sm" onClick={handleEditLast}>
                    <IconPencil className="h-3.5 w-3.5" /> Edit Last
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleUndoLast} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                    <IconTrash className="h-3.5 w-3.5" /> Undo Last
                  </Button>
                </>
              }
            >
              {timesheets.length === 0 ? (
                <EmptyState
                  className="m-5"
                  icon={<IconClock className="h-5 w-5" />}
                  title="No entries yet"
                  description="Log your first entry using the form on the left."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50/60">
                      <tr>
                        <Th>Date</Th>
                        <Th>Project</Th>
                        <Th className="text-right">Hrs</Th>
                        <Th>Work Done</Th>
                        <Th className="text-right">Actions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {timesheets.map(t => {
                        // Admins can edit anything; users edit only their own
                        // entries that are still inside the backfill window.
                        const canEdit = (isAdmin || t.user_id === user?.id) && (isAdmin || t.log_date >= minLogDate)
                        if (editingId === t.id) {
                          return (
                            <tr key={t.id} className="bg-primary-50/60">
                              <td colSpan={5} className="p-3">
                                <form onSubmit={handleUpdateEntry} className="flex flex-wrap items-end gap-2">
                                  <Field label="Date" className="w-36">
                                    <Input type="date" value={editLogDate} onChange={(e) => setEditLogDate(e.target.value)} required className="text-xs" />
                                  </Field>
                                  <Field label="Project" className="w-44">
                                    <Select value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)} required className="text-xs">
                                      <option value="">Select Project…</option>
                                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </Select>
                                  </Field>
                                  <Field label="Hours" className="w-20">
                                    <Input type="number" step="0.25" min="0" value={editHours} onChange={(e) => setEditHours(e.target.value)} required className="text-xs" />
                                  </Field>
                                  <Field label="Work Done" className="min-w-40 flex-1">
                                    <Input type="text" value={editWorkDone} onChange={(e) => setEditWorkDone(e.target.value)} required placeholder="Work Done" className="text-xs" />
                                  </Field>
                                  <Button type="submit" size="sm">
                                    <IconCheck className="h-3.5 w-3.5" /> Save
                                  </Button>
                                  <Button type="button" variant="secondary" size="sm" onClick={cancelEdit}>
                                    Cancel
                                  </Button>
                                </form>
                              </td>
                            </tr>
                          )
                        }
                        return (
                          <tr key={t.id} className="transition-colors hover:bg-slate-50/70">
                            <Td className="whitespace-nowrap tabular-nums">{t.log_date}</Td>
                            <Td className="font-medium text-slate-800">{t.projects?.name}</Td>
                            <Td className="text-right tabular-nums">{t.hours_worked}</Td>
                            <Td className="max-w-xs truncate text-slate-500">{t.work_done}</Td>
                            <Td className="text-right">
                              {canEdit ? (
                                <div className="inline-flex items-center gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => startEdit(t)} className="px-2 text-primary-600 hover:bg-primary-50">
                                    <IconPencil className="h-3.5 w-3.5" />
                                    <span className="sr-only">Edit</span>
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => handleDeleteEntry(t.id)} className="px-2 text-rose-600 hover:bg-rose-50">
                                    <IconTrash className="h-3.5 w-3.5" />
                                    <span className="sr-only">Delete</span>
                                  </Button>
                                </div>
                              ) : (
                                <Badge tone="slate">View only</Badge>
                              )}
                            </Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
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
          {isAdmin && (
            <SettingsPanel value={backfillWindow} onSaved={setBackfillWindow} />
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Add User (admin only) */}
            {isAdmin && (
              <Card
                title="Add User"
                subtitle="Create an account and set its role"
                icon={<IconPlus className="h-4.5 w-4.5" />}
              >
                <form onSubmit={handleAddUser} className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <Field label="Full Name">
                    <Input placeholder="Jane Doe" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} required />
                  </Field>
                  <Field label="Email">
                    <Input type="email" placeholder="you@company.com" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} required />
                  </Field>
                  <Field label="Temporary Password" className="sm:col-span-2">
                    <Input type="password" placeholder="At least 6 characters" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} required />
                  </Field>
                  <Field label="Department">
                    <Input placeholder="Engineering" value={newUserDepartment} onChange={(e) => setNewUserDepartment(e.target.value)} />
                  </Field>
                  <Field label="Title">
                    <Input placeholder="Software Engineer" value={newUserTitle} onChange={(e) => setNewUserTitle(e.target.value)} />
                  </Field>
                  <Field label="Role">
                    <Select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as UserRole)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </Field>
                  <Field label="Status">
                    <label className="flex h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-3 shadow-sm">
                      <input
                        type="checkbox"
                        checked={newUserActive}
                        onChange={(e) => setNewUserActive(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 accent-primary-600"
                      />
                      <span className="text-sm text-slate-700">Active</span>
                    </label>
                  </Field>
                  <Button type="submit" className="sm:col-span-2">
                    <IconPlus className="h-4 w-4" /> Add User
                  </Button>
                </form>
              </Card>
            )}

            {/* Backfill Yesterday (admin only) */}
            {isAdmin && (
              <Card
                title="Backfill Yesterday"
                subtitle="Log yesterday's entry for another user"
                icon={<IconCalendar className="h-4.5 w-4.5" />}
              >
                <form onSubmit={handleAdminBackfill} className="space-y-3.5">
                  <Field label="User">
                    <Select value={backfillUserId} onChange={(e) => setBackfillUserId(e.target.value)} required>
                      <option value="">Select User…</option>
                      {allUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                    </Select>
                  </Field>
                  <Field label="Project">
                    <Select value={backfillProjectId} onChange={(e) => setBackfillProjectId(e.target.value)} required>
                      <option value="">Select Project…</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Hours">
                      <Input type="number" step="0.25" min="0" placeholder="8.0" value={backfillHours} onChange={(e) => setBackfillHours(e.target.value)} required />
                    </Field>
                    <Field label="Work Done">
                      <Input type="text" placeholder="Summary" value={backfillWorkDone} onChange={(e) => setBackfillWorkDone(e.target.value)} required />
                    </Field>
                  </div>
                  <Button type="submit" variant="secondary" className="w-full">
                    Save for User (cap: 1/day)
                  </Button>
                </form>
              </Card>
            )}
          </div>

          {/* User Whitelist (admin only) */}
          {isAdmin && (
            <Card
              title="User Whitelist"
              subtitle="Manage roles and account activation"
              icon={<IconUsers className="h-4.5 w-4.5" />}
              bodyClassName="p-0"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50/60">
                    <tr>
                      <Th>Name</Th>
                      <Th>Email</Th>
                      <Th>Department</Th>
                      <Th>Title</Th>
                      <Th>Role</Th>
                      <Th className="text-center">Status</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allUsers.map(u => (
                      <tr key={u.id} className="transition-colors hover:bg-slate-50/70">
                        <Td className="font-medium text-slate-800">{u.name || '—'}</Td>
                        <Td className="text-slate-500">{u.email}</Td>
                        <Td className="text-slate-500">{u.department || '—'}</Td>
                        <Td className="text-slate-500">{u.title || '—'}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <RoleBadge role={u.role} />
                            <select
                              value={u.role}
                              disabled={u.id === user.id}
                              onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                              className="cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:opacity-40"
                            >
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                        </Td>
                        <Td className="text-center">
                          <button
                            onClick={() => handleToggleUserStatus(u.id)}
                            disabled={u.id === user.id && u.is_active}
                            title={u.id === user.id && u.is_active ? 'You cannot deactivate your own account' : undefined}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${
                              u.is_active
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                                : 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            {u.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Project Management (admin + PM) */}
          {canManageProjects && (
            <ProjectManager projects={projects} onChanged={fetchProjects} />
          )}

          {/* Leave Management (admin only) */}
          {isAdmin && (
            <LeavePanel variant="admin" userId={profile?.id || ''} users={allUsers} />
          )}

          {/* Report Generation (admin + CO) */}
          {canGenerateReports && (
            <Card
              title="Generate Reports"
              subtitle="Filter the system and export to CSV"
              icon={<IconDocument className="h-4.5 w-4.5" />}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="User">
                  <Select value={reportUser} onChange={(e) => setReportUser(e.target.value)}>
                    <option value="all">All Users</option>
                    {allUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                  </Select>
                </Field>
                <Field label="From">
                  <Input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} />
                </Field>
                <Field label="To">
                  <Input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} />
                </Field>
                <Field label="&nbsp;">
                  <Button variant="success" onClick={generateReport} className="w-full">
                    <IconDocument className="h-4 w-4" /> Export CSV
                  </Button>
                </Field>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Note: The table view above shows all records in the system; the export respects
                the filters you choose.
              </p>
            </Card>
          )}
        </div>
      )}
    </AppShell>
  )
}

// app/dashboard/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
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

const supabase = createClient()

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  pm: 'PM',
  co: 'CO',
  user: 'User',
}

const ROLES: UserRole[] = ['admin', 'pm', 'co', 'user']

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
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
    const { data, error } = await supabase.from('profiles').select('*')
    if (error) { setDataError(error.message); return }
    setDataError(null)
    if (data) setAllUsers(data)
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
      }
    }
  }, [fetchAllUsers, fetchProjects, fetchTimesheets])

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
    if (error) alert('Error: ' + error)
    else {
      setHours(''); setWorkDone('')
      fetchTimesheets()
      alert('Logged successfully!')
    }
  }

  const handleLogYesterday = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await logYesterday({
      projectId: yesterdayProjectId,
      hoursWorked: parseFloat(yesterdayHours),
      workDone: yesterdayWorkDone,
    })
    if (error) alert('Error: ' + error)
    else {
      setYesterdayProjectId('')
      setYesterdayHours('')
      setYesterdayWorkDone('')
      fetchTimesheets()
      alert('Logged for yesterday!')
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
    if (error) alert('Error: ' + error)
    else {
      setBackfillUserId('')
      setBackfillProjectId('')
      setBackfillHours('')
      setBackfillWorkDone('')
      fetchTimesheets()
      alert('Backfill saved!')
    }
  }

  const handleUndoLast = async () => {
    if (!confirm('Delete your most recent entry?')) return
    const { error } = await deleteLastEntry()
    if (error) alert('Error: ' + error)
    else fetchTimesheets()
  }

  const handleEditLast = () => {
    if (timesheets.length === 0) return alert('No entries to edit.')
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
    if (error) alert('Error: ' + error)
    else {
      cancelEdit()
      fetchTimesheets()
      alert('Entry updated successfully!')
    }
  }

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return
    const { error } = await deleteTimesheet(entryId)
    if (error) alert('Error: ' + error)
    else {
      if (editingId === entryId) cancelEdit()
      fetchTimesheets()
    }
  }

  const handleToggleUserStatus = async (userId: string) => {
    const { error } = await toggleUserStatus(userId)
    if (error) alert('Error: ' + error)
    else fetchAllUsers()
  }

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const { error } = await updateUserRole(userId, newRole)
    if (error) alert('Error: ' + error)
    else fetchAllUsers()
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
    if (error) alert('Error: ' + error)
    else {
      setNewUserName('')
      setNewUserEmail('')
      setNewUserPassword('')
      setNewUserDepartment('')
      setNewUserTitle('')
      setNewUserRole('user')
      setNewUserActive(true)
      fetchAllUsers()
      alert('User added successfully!')
    }
  }

  const generateReport = () => {
    let dataToExport = timesheets

    if (reportStartDate) dataToExport = dataToExport.filter(t => t.log_date >= reportStartDate)
    if (reportEndDate) dataToExport = dataToExport.filter(t => t.log_date <= reportEndDate)
    if (reportUser !== 'all') dataToExport = dataToExport.filter(t => t.user_id === reportUser)

    if (dataToExport.length === 0) return alert('No data found for selected criteria.')

    const headers = ['Date', 'User', 'Project', 'Hours', 'Work Done']
    const rows = dataToExport.map(t => [
      t.log_date,
      t.profiles?.email || 'Unknown',
      t.projects?.name || 'Unknown',
      t.hours_worked,
      `"${t.work_done.replace(/"/g, '""')}"`
    ])

    let csvContent = headers.join(',') + '\n'
    rows.forEach(row => csvContent += row.join(',') + '\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `report_${new Date().getTime()}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 0)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>

  if (!user) return null

  // PENDING APPROVAL VIEW
  if (user && (!profile || !profile.is_active)) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <h1 className="text-2xl font-bold mb-4 text-orange-600">Account Pending Approval</h1>
        <p className="text-gray-700 mb-4">
          {profile?.name ? `${profile.name}, your` : 'Your'} account is waiting for Admin activation.
        </p>
        {dataError && <p className="text-red-600 text-sm mb-4">Error: {dataError}</p>}
        <button onClick={handleLogout} className="text-red-600 hover:underline">Logout</button>
      </main>
    )
  }

  // AUTHORIZED VIEW
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">VSIS Time Sheet</h1>
            <p className="text-gray-500">
              Welcome, {profile?.name || profile?.email}
              {profile?.department ? ` (${profile.department})` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {showAdminPanel && (
              <button
                onClick={() => setActiveTab(activeTab === 'admin' ? 'user' : 'admin')}
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'admin' ? 'bg-purple-600 text-white' : 'bg-white border text-purple-600'}`}
              >
                {activeTab === 'admin' ? 'Exit Admin Panel' : 'Admin Panel'}
              </button>
            )}
            <Link
              href="/reports"
              className="bg-white border text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-100"
            >
              Reports
            </Link>
            <Link
              href="/change-password"
              className="bg-white border text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-100"
            >
              Change Password
            </Link>
            <button onClick={handleLogout} className="bg-red-100 text-red-700 px-4 py-2 rounded-lg font-medium hover:bg-red-200">
              Logout
            </button>
          </div>
        </div>

        {dataError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            Error loading data: {dataError}
          </div>
        )}

        {/* USER VIEW */}
        {activeTab === 'user' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Log Form */}
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4">Log Time</h2>
              <form onSubmit={handleLogEntry} className="space-y-3">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className="w-full border p-2 rounded">
                  <option value="">Select Project...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} required className="w-full border p-2 rounded" />
                <input type="number" step="0.25" min="0" placeholder="Hours" value={hours} onChange={(e) => setHours(e.target.value)} required className="w-full border p-2 rounded" />
                <textarea placeholder="Work Done" value={workDone} onChange={(e) => setWorkDone(e.target.value)} required className="w-full border p-2 rounded h-24" />
                <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">Submit</button>
              </form>
              <button
                type="button"
                onClick={() => setShowYesterday(!showYesterday)}
                className="w-full text-blue-600 text-sm hover:underline mt-3"
              >
                {showYesterday ? 'Hide yesterday form' : 'Log Yesterday (cap: 1/day)'}
              </button>
              {showYesterday && (
                <form onSubmit={handleLogYesterday} className="space-y-3 mt-2 border-t pt-3">
                  <select value={yesterdayProjectId} onChange={(e) => setYesterdayProjectId(e.target.value)} required className="w-full border p-2 rounded">
                    <option value="">Select Project...</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" step="0.25" min="0" placeholder="Hours" value={yesterdayHours} onChange={(e) => setYesterdayHours(e.target.value)} required className="w-full border p-2 rounded" />
                  <input type="text" placeholder="Work Done" value={yesterdayWorkDone} onChange={(e) => setYesterdayWorkDone(e.target.value)} required className="w-full border p-2 rounded" />
                  <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">Save Yesterday</button>
                </form>
              )}
            </div>

            {/* User's Records */}
            <div className="md:col-span-2 bg-white p-6 rounded-lg shadow-sm border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">My Recent Entries</h2>
                <div className="flex gap-3 text-sm">
                  <button onClick={handleEditLast} className="text-blue-600 hover:underline">Edit Last</button>
                  <button onClick={handleUndoLast} className="text-red-600 hover:underline">Undo Last</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Project</th>
                      <th className="p-2">Hrs</th>
                      <th className="p-2">Work Done</th>
                      <th className="p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timesheets.map(t => {
                      const canEdit = isAdmin || t.user_id === user?.id
                      if (editingId === t.id) {
                        return (
                          <tr key={t.id} className="border-b bg-blue-50">
                            <td colSpan={5} className="p-2">
                              <form onSubmit={handleUpdateEntry} className="flex flex-wrap gap-2 items-end">
                                <input type="date" value={editLogDate} onChange={(e) => setEditLogDate(e.target.value)} required className="border p-1 rounded text-sm" />
                                <select value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)} required className="border p-1 rounded text-sm">
                                  <option value="">Select Project...</option>
                                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                                <input type="number" step="0.25" min="0" value={editHours} onChange={(e) => setEditHours(e.target.value)} required className="border p-1 rounded text-sm w-20" />
                                <input type="text" value={editWorkDone} onChange={(e) => setEditWorkDone(e.target.value)} required placeholder="Work Done" className="border p-1 rounded text-sm flex-1 min-w-40" />
                                <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Save</button>
                                <button type="button" onClick={cancelEdit} className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-xs">Cancel</button>
                              </form>
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <tr key={t.id} className="border-b">
                          <td className="p-2">{t.log_date}</td>
                          <td className="p-2">{t.projects?.name}</td>
                          <td className="p-2">{t.hours_worked}</td>
                          <td className="p-2 max-w-xs truncate">{t.work_done}</td>
                          <td className="p-2 whitespace-nowrap">
                            {canEdit ? (
                              <>
                                <button onClick={() => startEdit(t)} className="text-blue-600 hover:underline mr-2">Edit</button>
                                <button onClick={() => handleDeleteEntry(t.id)} className="text-red-600 hover:underline">Delete</button>
                              </>
                            ) : (
                              <span className="text-gray-400 text-xs">View only</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Leave + Reminders (all users) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <LeavePanel variant="own" userId={profile?.id || ''} />
          <RemindersPanel userId={profile?.id || ''} />
        </div>

        {/* ADMIN PANEL */}
        {activeTab === 'admin' && (
          <div className="space-y-8">

            {/* Add User (admin only) */}
            {isAdmin && (
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 text-purple-700">Add User</h2>
                <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input type="text" placeholder="Full Name" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} required className="border p-2 rounded" />
                  <input type="email" placeholder="Email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} required className="border p-2 rounded" />
                  <input type="password" placeholder="Temporary Password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} required className="border p-2 rounded" />
                  <input type="text" placeholder="Department" value={newUserDepartment} onChange={(e) => setNewUserDepartment(e.target.value)} className="border p-2 rounded" />
                  <input type="text" placeholder="Title" value={newUserTitle} onChange={(e) => setNewUserTitle(e.target.value)} className="border p-2 rounded" />
                  <div className="flex items-center gap-3">
                    <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as UserRole)} className="border p-2 rounded flex-1">
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={newUserActive} onChange={(e) => setNewUserActive(e.target.checked)} />
                      Active
                    </label>
                  </div>
                  <button type="submit" className="md:col-span-2 bg-purple-600 text-white py-2 rounded hover:bg-purple-700">
                    Add User
                  </button>
                </form>
              </div>
            )}

            {/* Backfill Yesterday (admin only) */}
            {isAdmin && (
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 text-purple-700">Backfill Yesterday</h2>
                <form onSubmit={handleAdminBackfill} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select value={backfillUserId} onChange={(e) => setBackfillUserId(e.target.value)} required className="border p-2 rounded">
                    <option value="">Select User...</option>
                    {allUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                  </select>
                  <select value={backfillProjectId} onChange={(e) => setBackfillProjectId(e.target.value)} required className="border p-2 rounded">
                    <option value="">Select Project...</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" step="0.25" min="0" placeholder="Hours" value={backfillHours} onChange={(e) => setBackfillHours(e.target.value)} required className="border p-2 rounded" />
                  <input type="text" placeholder="Work Done" value={backfillWorkDone} onChange={(e) => setBackfillWorkDone(e.target.value)} required className="border p-2 rounded" />
                  <button type="submit" className="md:col-span-2 bg-purple-600 text-white py-2 rounded hover:bg-purple-700">
                    Save for User (cap: 1/day)
                  </button>
                </form>
              </div>
            )}

            {/* User Whitelist (admin only) */}
            {isAdmin && (
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 text-purple-700">User Whitelist</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">Name</th>
                        <th className="p-2 text-left">Email</th>
                        <th className="p-2 text-left">Department</th>
                        <th className="p-2 text-left">Title</th>
                        <th className="p-2 text-center">Role</th>
                        <th className="p-2 text-center">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allUsers.map(u => (
                        <tr key={u.id} className="border-b">
                          <td className="p-2">{u.name || '—'}</td>
                          <td className="p-2">{u.email}</td>
                          <td className="p-2">{u.department || '—'}</td>
                          <td className="p-2">{u.title || '—'}</td>
                          <td className="p-2 text-center">
                            <select
                              value={u.role}
                              disabled={u.id === user.id}
                              onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                              className={`px-2 py-1 rounded text-xs border disabled:opacity-50 ${
                                u.role === 'admin' ? 'bg-purple-200 text-purple-800'
                                : u.role === 'pm' ? 'bg-blue-200 text-blue-800'
                                : u.role === 'co' ? 'bg-green-200 text-green-800'
                                : 'bg-gray-200 text-gray-800'
                              }`}
                            >
                              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </select>
                          </td>
                          <td className="p-2 text-center">
                            <button
                              onClick={() => handleToggleUserStatus(u.id)}
                              className={`px-2 py-1 rounded text-xs ${u.is_active ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}
                            >
                              {u.is_active ? 'Active' : 'Inactive'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
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
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 text-purple-700">Generate Reports</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <select value={reportUser} onChange={(e) => setReportUser(e.target.value)} className="border p-2 rounded">
                    <option value="all">All Users</option>
                    {allUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                  </select>
                  <input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} className="border p-2 rounded" />
                  <input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} className="border p-2 rounded" />
                  <button onClick={generateReport} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Export CSV</button>
                </div>
                <p className="text-xs text-gray-500">Note: Table view below shows all records in the system.</p>
              </div>
            )}

          </div>
        )}

      </div>
    </main>
  )
}

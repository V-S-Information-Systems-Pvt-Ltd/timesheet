// app/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Project, Timesheet } from './types'

const supabase = createClient()

export default function Home() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  // Form states
  const [activeTab, setActiveTab] = useState<'user' | 'admin'>('user')
  const [projectId, setProjectId] = useState('')
  const [hours, setHours] = useState('')
  const [workDone, setWorkDone] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [reportUser, setReportUser] = useState('all')
  const [reportStartDate, setReportStartDate] = useState('')
  const [reportEndDate, setReportEndDate] = useState('')
  const [newProjectName, setNewProjectName] = useState('')

  const fetchProjects = useCallback(async () => {
    const { data } = await supabase.from('projects').select('*')
    if (data) setProjects(data)
  }, [])

  const fetchTimesheets = useCallback(async () => {
    // By default, RLS ensures users only get their own. Admins get all.
    const { data } = await supabase
      .from('timesheets')
      .select('*, projects(name), profiles(email)')
      .order('log_date', { ascending: false })
    if (data) setTimesheets(data)
  }, [])

  const fetchAllUsers = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*')
    if (data) setAllUsers(data)
  }, [])

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) {
      setProfile(data as User)
      if (data.is_active) {
        fetchProjects()
        fetchTimesheets()
        if (data.is_admin) fetchAllUsers()
      }
    }
  }, [fetchAllUsers, fetchProjects, fetchTimesheets])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setUser(session.user as unknown as User)
        await fetchProfile(session.user.id)
      }
      setLoading(false)
    }
    init()
  }, [fetchProfile])

  const handleLogin = async () => {
    const email = prompt('Enter your email to login:')
    if (email) {
      await supabase.auth.signInWithOtp({ email })
      alert('Check your email for the login link!')
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setTimesheets([])
  }

  const handleLogEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('timesheets').insert({
      user_id: user?.id,
      project_id: projectId,
      hours_worked: parseFloat(hours),
      work_done: workDone,
      log_date: logDate
    })
    if (error) alert('Error: ' + error.message)
    else {
      setHours(''); setWorkDone('')
      fetchTimesheets()
      alert('Logged successfully!')
    }
  }

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    await supabase.from('profiles').update({ is_active: !currentStatus }).eq('id', userId)
    fetchAllUsers()
  }

  const toggleAdminStatus = async (userId: string, currentStatus: boolean) => {
    await supabase.from('profiles').update({ is_admin: !currentStatus }).eq('id', userId)
    fetchAllUsers()
  }

  const addProject = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('projects').insert({ name: newProjectName })
    if (error) alert(error.message)
    else {
      setNewProjectName('')
      fetchProjects()
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
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>

  // UNAUTHENTICATED VIEW
  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <h1 className="text-3xl font-bold mb-4">VSIS Time Sheet System</h1>
        <button onClick={handleLogin} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700">
          Login / Sign Up
        </button>
        <p className="text-gray-500 text-sm mt-4">Admin must approve your account before you can log hours.</p>
      </main>
    )
  }

  // PENDING APPROVAL VIEW
  if (user && profile && !profile.is_active) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <h1 className="text-2xl font-bold mb-4 text-orange-600">Account Pending Approval</h1>
        <p className="text-gray-700 mb-4">Your account is waiting for Admin activation.</p>
        <button onClick={handleLogout} className="text-red-600 hover:underline">Logout</button>
      </main>
    )
  }

  // AUTHORIZED VIEW (USER & ADMIN)
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">VSIS Time Sheet</h1>
            <p className="text-gray-500">Welcome, {profile?.email}</p>
          </div>
          <div className="flex gap-2">
            {profile?.is_admin && (
              <button 
                onClick={() => setActiveTab(activeTab === 'admin' ? 'user' : 'admin')}
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'admin' ? 'bg-purple-600 text-white' : 'bg-white border text-purple-600'}`}
              >
                {activeTab === 'admin' ? 'Exit Admin' : 'Admin Panel'}
              </button>
            )}
            <button onClick={handleLogout} className="bg-red-100 text-red-700 px-4 py-2 rounded-lg font-medium hover:bg-red-200">
              Logout
            </button>
          </div>
        </div>

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
            </div>

            {/* User's Records */}
            <div className="md:col-span-2 bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4">My Recent Entries</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Project</th>
                      <th className="p-2">Hrs</th>
                      <th className="p-2">Work Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timesheets.map(t => (
                      <tr key={t.id} className="border-b">
                        <td className="p-2">{t.log_date}</td>
                        <td className="p-2">{t.projects?.name}</td>
                        <td className="p-2">{t.hours_worked}</td>
                        <td className="p-2 max-w-xs truncate">{t.work_done}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ADMIN VIEW */}
        {activeTab === 'admin' && profile?.is_admin && (
          <div className="space-y-8">
            
            {/* Project Management */}
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4 text-purple-700">Project Management</h2>
              <form onSubmit={addProject} className="flex gap-2 mb-4">
                <input type="text" placeholder="New Project Name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} required className="flex-1 border p-2 rounded" />
                <button type="submit" className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">Add Project</button>
              </form>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {projects.map(p => <div key={p.id} className="bg-gray-50 p-2 rounded text-sm border">{p.name}</div>)}
              </div>
            </div>

            {/* Whitelist Management */}
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4 text-purple-700">User Whitelist</h2>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-center">Active</th>
                    <th className="p-2 text-center">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map(u => (
                    <tr key={u.id} className="border-b">
                      <td className="p-2">{u.email}</td>
                      <td className="p-2 text-center">
                        <button 
                          onClick={() => toggleUserStatus(u.id, u.is_active)}
                          className={`px-2 py-1 rounded text-xs ${u.is_active ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}
                        >
                          {u.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="p-2 text-center">
                        <button 
                          onClick={() => toggleAdminStatus(u.id, u.is_admin)}
                          className={`px-2 py-1 rounded text-xs ${u.is_admin ? 'bg-purple-200 text-purple-800' : 'bg-gray-200 text-gray-800'}`}
                        >
                          {u.is_admin ? 'Admin' : 'User'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Report Generation */}
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4 text-purple-700">Generate Reports</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <select value={reportUser} onChange={(e) => setReportUser(e.target.value)} className="border p-2 rounded">
                  <option value="all">All Users</option>
                  {allUsers.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
                </select>
                <input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} className="border p-2 rounded" />
                <input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} className="border p-2 rounded" />
                <button onClick={generateReport} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Export CSV</button>
              </div>
              <p className="text-xs text-gray-500">Note: Table view below shows all records in the system.</p>
            </div>

          </div>
        )}

      </div>
    </main>
  )
}

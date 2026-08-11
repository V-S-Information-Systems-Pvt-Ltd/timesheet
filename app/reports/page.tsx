// app/reports/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LeaveEntry, Project, Timesheet, User } from '../types'

const supabase = createClient()

type Preset = 'this' | 'last' | 'prev2' | 'prev3' | 'custom'

function dateToISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthStartOffset(offset: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return dateToISO(d)
}

function monthEndOffset(offset: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset + 1)
  d.setDate(0)
  return dateToISO(d)
}

function presetRange(preset: Preset, customStart: string, customEnd: string): { start: string; end: string } {
  if (preset === 'custom') return { start: customStart || monthStartOffset(0), end: customEnd || dateToISO(new Date()) }
  const offset = preset === 'this' ? 0 : preset === 'last' ? -1 : preset === 'prev2' ? -2 : -3
  if (preset === 'this') return { start: monthStartOffset(0), end: dateToISO(new Date()) }
  return { start: monthStartOffset(offset), end: monthEndOffset(offset) }
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 0)
}

function sumHours(rows: Timesheet[]): number {
  return rows.reduce((acc, t) => acc + (Number(t.hours_worked) || 0), 0)
}

function selectRows(rows: Timesheet[], start: string, end: string, project: string, user: string | null): Timesheet[] {
  return rows.filter(t =>
    t.log_date >= start &&
    t.log_date <= end &&
    (project === 'all' || t.project_id === project) &&
    (user === null || t.user_id === user)
  )
}

export default function ReportsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<User | null>(null)
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [leaves, setLeaves] = useState<LeaveEntry[]>([])

  const [tab, setTab] = useState<'myhours' | 'summaries' | 'reports' | 'compare' | 'missing'>('myhours')
  const [preset, setPreset] = useState<Preset>('this')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [userFilter, setUserFilter] = useState<'me' | 'all' | string>('me')
  const [summaryProject, setSummaryProject] = useState('')
  const [compareProject, setCompareProject] = useState('')
  const [compareA, setCompareA] = useState<Preset>('this')
  const [compareB, setCompareB] = useState<Preset>('last')
  const [customMonth, setCustomMonth] = useState('')
  const [lastExport, setLastExport] = useState<{ filename: string; headers: string[]; rows: (string | number)[][] } | null>(null)

  const isReportRole = profile?.role === 'admin' || profile?.role === 'co'
  const myId = profile?.id

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace('/')
        return
      }
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.session.user.id)
        .single()
      setProfile(profileData as User)
      setLoading(false)
    })
  }, [router])

  useEffect(() => {
    if (!profile) return
    ;(async () => {
      const [ts, pr, us, lv] = await Promise.all([
        supabase.from('timesheets').select('*, projects(name), profiles(email)').order('log_date', { ascending: false }),
        supabase.from('projects').select('*').order('name'),
        supabase.from('profiles').select('*'),
        supabase.from('leaves').select('*'),
      ])
      if (!ts.error && ts.data) setTimesheets(ts.data)
      if (!pr.error && pr.data) setProjects(pr.data)
      if (!us.error && us.data) setUsers(us.data)
      if (!lv.error && lv.data) setLeaves(lv.data)
    })()
  }, [profile])

  const range = presetRange(preset, customStart, customEnd)

  const visibleRows = useMemo(() => {
    const user: string | null = userFilter === 'me' ? (myId ?? null) : userFilter === 'all' ? null : userFilter
    return selectRows(timesheets, range.start, range.end, projectFilter, user)
  }, [timesheets, range, projectFilter, userFilter, myId])

  const exportVisible = () => {
    const headers = ['Date', 'User', 'Project', 'Hours', 'Work Done']
    const rows = visibleRows.map(t => [
      t.log_date,
      t.profiles?.email || 'Unknown',
      t.projects?.name || 'Unknown',
      t.hours_worked,
      t.work_done,
    ])
    const filename = `report_${range.start}_${range.end}.csv`
    downloadCSV(filename, headers, rows)
    setLastExport({ filename, headers, rows })
  }

  const exportMonth = (offset: number) => {
    const start = monthStartOffset(offset)
    const end = monthEndOffset(offset)
    const rows = selectRows(timesheets, start, end, 'all', null)
    const headers = ['Date', 'User', 'Project', 'Hours', 'Work Done']
    const data = rows.map(t => [t.log_date, t.profiles?.email || 'Unknown', t.projects?.name || 'Unknown', t.hours_worked, t.work_done])
    const filename = `report_${start.slice(0, 7)}.csv`
    downloadCSV(filename, headers, data)
    setLastExport({ filename, headers, rows: data })
  }

  const exportLast3 = () => {
    const headers = ['Month', 'Date', 'User', 'Project', 'Hours', 'Work Done']
    const data: (string | number)[][] = []
    for (let offset = -1; offset >= -3; offset--) {
      const start = monthStartOffset(offset)
      const end = monthEndOffset(offset)
      selectRows(timesheets, start, end, 'all', null).forEach(t => data.push([start.slice(0, 7), t.log_date, t.profiles?.email || 'Unknown', t.projects?.name || 'Unknown', t.hours_worked, t.work_done]))
    }
    const filename = `report_last3_${monthStartOffset(-3).slice(0, 7)}_${monthEndOffset(-1).slice(0, 7)}.csv`
    downloadCSV(filename, headers, data)
    setLastExport({ filename, headers, rows: data })
  }

  const exportLast3Total = () => {
    const start = monthStartOffset(-3)
    const end = monthEndOffset(-1)
    const rows = selectRows(timesheets, start, end, 'all', null)
    const byUser = new Map<string, number>()
    rows.forEach(t => byUser.set(t.profiles?.email || 'Unknown', (byUser.get(t.profiles?.email || 'Unknown') || 0) + (Number(t.hours_worked) || 0)))
    const headers = ['User', 'Total Hours']
    const data = Array.from(byUser.entries()).map(([email, hours]) => [email, Math.round(hours * 100) / 100])
    const filename = `report_last3_total_${start.slice(0, 7)}_${end.slice(0, 7)}.csv`
    downloadCSV(filename, headers, data)
    setLastExport({ filename, headers, rows: data })
  }

  const exportCustomMonth = () => {
    if (!/^\d{4}-\d{2}$/.test(customMonth || '')) return alert('Enter a month as YYYY-MM.')
    const start = customMonth + '-01'
    const end = dateToISO(new Date(new Date(customMonth + '-01T00:00:00').getFullYear(), new Date(customMonth + '-01T00:00:00').getMonth() + 1, 0))
    const rows = selectRows(timesheets, start, end, 'all', null)
    const headers = ['Date', 'User', 'Project', 'Hours', 'Work Done']
    const data = rows.map(t => [t.log_date, t.profiles?.email || 'Unknown', t.projects?.name || 'Unknown', t.hours_worked, t.work_done])
    const filename = `report_${customMonth}.csv`
    downloadCSV(filename, headers, data)
    setLastExport({ filename, headers, rows: data })
  }

  // Summaries
  const mySummaryRows = useMemo(() => {
    if (!myId) return []
    return selectRows(timesheets, range.start, range.end, projectFilter, myId)
  }, [timesheets, range, projectFilter, myId])

  const projectSummaryRows = useMemo(() => {
    if (!summaryProject) return []
    const rows = selectRows(timesheets, range.start, range.end, summaryProject, null)
    const byUser = new Map<string, number>()
    rows.forEach(t => byUser.set(t.profiles?.email || 'Unknown', (byUser.get(t.profiles?.email || 'Unknown') || 0) + (Number(t.hours_worked) || 0)))
    return Array.from(byUser.entries()).map(([email, hours]) => ({ email, hours })).sort((a, b) => b.hours - a.hours)
  }, [timesheets, range, summaryProject])

  const compareRows = useMemo(() => {
    if (!compareProject) return { a: 0, b: 0, aLabel: '', bLabel: '' }
    const a = presetRange(compareA, '', '')
    const b = presetRange(compareB, '', '')
    return {
      a: sumHours(selectRows(timesheets, a.start, a.end, compareProject, null)),
      b: sumHours(selectRows(timesheets, b.start, b.end, compareProject, null)),
      aLabel: `${a.start} – ${a.end}`,
      bLabel: `${b.start} – ${b.end}`,
    }
  }, [timesheets, compareProject, compareA, compareB])

  const missingDays = useMemo(() => {
    if (!myId) return []
    const today = new Date()
    const days: string[] = []
    for (let d = new Date(today.getFullYear(), today.getMonth(), 1); d <= today; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay()
      if (dow === 0 || dow === 6) continue
      const iso = dateToISO(d)
      const hasEntry = timesheets.some(t => t.user_id === myId && t.log_date === iso)
      const onLeave = leaves.some(l => l.user_id === myId && l.leave_date === iso)
      if (!hasEntry && !onLeave) days.push(iso)
    }
    return days
  }, [timesheets, leaves, myId])

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  if (!profile) return null

  const presetSelect = (
    <div className="flex flex-wrap gap-2 items-center">
      <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="border p-2 rounded text-sm">
        <option value="this">This Month</option>
        <option value="last">Last Month</option>
        <option value="prev2">2 Months Ago</option>
        <option value="prev3">3 Months Ago</option>
        <option value="custom">Custom Range</option>
      </select>
      {preset === 'custom' && (
        <>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="border p-2 rounded text-sm" />
          <span className="text-gray-500 text-sm">to</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="border p-2 rounded text-sm" />
        </>
      )}
      <span className="text-sm text-gray-500">{range.start} → {range.end}</span>
    </div>
  )

  const projectSelect = (value: string, onChange: (v: string) => void, allLabel = 'All Projects') => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border p-2 rounded text-sm">
      <option value="all">{allLabel}</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
            <p className="text-gray-500">Hours, summaries, and exports.</p>
          </div>
          <Link href="/dashboard" className="bg-white border text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-100">
            Back to Dashboard
          </Link>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {([
            ['myhours', 'My Hours'],
            ['summaries', 'Summaries'],
            ['reports', 'Reports'],
            ['compare', 'Compare'],
            ['missing', 'My Missing'],
          ] as const).filter(([key]) => key !== 'reports' || isReportRole).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === key ? 'bg-purple-600 text-white' : 'bg-white border text-purple-600'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'myhours' && (
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <h2 className="text-xl font-semibold mb-4">My Hours</h2>
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              {presetSelect}
              {projectSelect(projectFilter, setProjectFilter)}
            </div>
            <p className="text-sm mb-3">
              Total: <strong>{Math.round(sumHours(visibleRows) * 100) / 100} hrs</strong> across {visibleRows.length} entr{visibleRows.length === 1 ? 'y' : 'ies'}
            </p>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="p-2">Date</th>
                    <th className="p-2">Project</th>
                    <th className="p-2">Hrs</th>
                    <th className="p-2">Work Done</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(t => (
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
            <div className="flex gap-2 mt-4">
              <button onClick={exportVisible} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">Export CSV</button>
              {lastExport && (
                <button onClick={() => downloadCSV(lastExport.filename, lastExport.headers, lastExport.rows)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-300">Rerun</button>
              )}
            </div>
          </div>
        )}

        {tab === 'summaries' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4">My Summary</h2>
              <div className="flex flex-wrap gap-2 mb-4 items-center">{presetSelect}{projectSelect(projectFilter, setProjectFilter)}</div>
              <p className="text-2xl font-bold text-purple-700 mb-2">{Math.round(sumHours(mySummaryRows) * 100) / 100} hrs</p>
              <p className="text-sm text-gray-500">{mySummaryRows.length} entr{mySummaryRows.length === 1 ? 'y' : 'ies'}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4">Project Summary</h2>
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                {presetSelect}
                <select value={summaryProject} onChange={(e) => setSummaryProject(e.target.value)} className="border p-2 rounded text-sm">
                  <option value="">Select Project...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {summaryProject ? (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr><th className="p-2 text-left">User</th><th className="p-2 text-center">Hours</th></tr>
                  </thead>
                  <tbody>
                    {projectSummaryRows.map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">{r.email}</td>
                        <td className="p-2 text-center">{Math.round(r.hours * 100) / 100}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400">Pick a project to see hours per user.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'reports' && isReportRole && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4">Group Report</h2>
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                {presetSelect}
                {projectSelect(projectFilter, setProjectFilter)}
                <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="border p-2 rounded text-sm">
                  <option value="all">All Users</option>
                  <option value="me">Me</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              </div>
              <p className="text-sm mb-3">Total: <strong>{Math.round(sumHours(visibleRows) * 100) / 100} hrs</strong></p>
              <button onClick={exportVisible} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">Export CSV</button>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4">User Report</h2>
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                <select value={userFilter === 'all' ? '' : userFilter} onChange={(e) => setUserFilter(e.target.value)} className="border p-2 rounded text-sm">
                  <option value="">Select User...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
                {presetSelect}
              </div>
              {userFilter && userFilter !== 'all' && userFilter !== 'me' && (
                <button onClick={exportVisible} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">Export User CSV</button>
              )}
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <h2 className="text-xl font-semibold mb-4">Monthly Exports</h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => exportMonth(0)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">This Month</button>
                <button onClick={() => exportMonth(-1)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Last Month</button>
                <button onClick={() => exportMonth(-2)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">2 Months Ago</button>
                <button onClick={() => exportMonth(-3)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">3 Months Ago</button>
                <button onClick={exportLast3} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Last 3 (one file)</button>
                <button onClick={exportLast3Total} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Last 3 Total</button>
              </div>
              <div className="flex gap-2 mt-4 items-center">
                <input type="month" value={customMonth} onChange={(e) => setCustomMonth(e.target.value)} className="border p-2 rounded text-sm" />
                <button onClick={exportCustomMonth} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Export Month</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'compare' && (
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <h2 className="text-xl font-semibold mb-4">Compare Project Across Periods</h2>
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              <select value={compareProject} onChange={(e) => setCompareProject(e.target.value)} className="border p-2 rounded text-sm">
                <option value="">Select Project...</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={compareA} onChange={(e) => setCompareA(e.target.value as Preset)} className="border p-2 rounded text-sm">
                <option value="this">This Month</option>
                <option value="last">Last Month</option>
                <option value="prev2">2 Months Ago</option>
                <option value="prev3">3 Months Ago</option>
              </select>
              <span className="text-gray-500 text-sm">vs</span>
              <select value={compareB} onChange={(e) => setCompareB(e.target.value as Preset)} className="border p-2 rounded text-sm">
                <option value="this">This Month</option>
                <option value="last">Last Month</option>
                <option value="prev2">2 Months Ago</option>
                <option value="prev3">3 Months Ago</option>
              </select>
            </div>
            {compareProject ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded border">
                  <div className="text-xs text-gray-500">{compareRows.aLabel}</div>
                  <div className="text-2xl font-bold">{Math.round(compareRows.a * 100) / 100} hrs</div>
                </div>
                <div className="bg-gray-50 p-4 rounded border">
                  <div className="text-xs text-gray-500">{compareRows.bLabel}</div>
                  <div className="text-2xl font-bold">{Math.round(compareRows.b * 100) / 100} hrs</div>
                </div>
                <div className="bg-purple-50 p-4 rounded border">
                  <div className="text-xs text-gray-500">Change</div>
                  <div className={`text-2xl font-bold ${compareRows.b - compareRows.a >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {Math.round((compareRows.b - compareRows.a) * 100) / 100} hrs
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Pick a project to compare two periods.</p>
            )}
          </div>
        )}

        {tab === 'missing' && (
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <h2 className="text-xl font-semibold mb-4">My Missing Days — {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h2>
            <p className="text-sm text-gray-500 mb-3">Weekdays so far this month with no entry and no leave marker.</p>
            {missingDays.length > 0 ? (
              <ul className="space-y-1">
                {missingDays.map(d => (
                  <li key={d} className="text-sm border-b py-1 flex justify-between">
                    <span>{d}</span>
                    <span className="text-gray-400">{new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-green-600 text-sm">All weekdays covered so far — nice work!</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

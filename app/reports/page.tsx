// app/reports/page.tsx
'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import { dataClient } from '@/lib/data/client'
import { LeaveEntry, Project, Timesheet, User } from '../types'
import { AppShell, Badge, Button, Card, EmptyState, Field, Input, PageHeader, SegmentedTabs, Select, StatCard, Td, Th } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCalendar, IconChart, IconCheck, IconCheckCircle, IconClock, IconDocument, IconDownload, IconScale, IconUsers } from '@/app/components/icons'
import { monthEndOffset, monthStartOffset, presetRange, toISODate, type Preset } from '@/lib/dates'
import { downloadCSV } from '@/lib/csv'
import { exportTimesheetCsv, fmtHours, selectRows, sumHours, timesheetCsvRows, TIMESHEET_CSV_HEADERS } from '@/lib/reports'

/** Timesheet rows fetched per page in the reports view. */
const PAGE_SIZE = 1000

function ReportsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<User | null>(null)
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [timesheetsLoading, setTimesheetsLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [leaves, setLeaves] = useState<LeaveEntry[]>([])

  const validTabs = ['myhours', 'summaries', 'reports', 'compare', 'missing'] as const
  const urlTab = searchParams?.get('tab') ?? ''
  const tab = validTabs.includes(urlTab as typeof validTabs[number])
    ? (urlTab as typeof validTabs[number])
    : 'myhours'
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
  const role = profile?.role ?? 'user'

  useEffect(() => {
    authClient.getSession().then(async ({ user }) => {
      if (!user) {
        router.replace('/')
        return
      }
      const { data: profileData } = await dataClient.getProfile(user.id)
      setProfile(profileData)
      setLoading(false)
    })
  }, [router])

  // Timesheets load in pages so the reports view never pulls the whole table
  // into the client at once; the other reference data is bounded by RLS or
  // an explicit limit.
  const loadedRef = useRef(0)

  const loadMoreTimesheets = useCallback(async () => {
    setLoadingMore(true)
    const from = loadedRef.current
    const { data, error } = await dataClient.getTimesheets({ from, to: from + PAGE_SIZE - 1 })
    if (!error && data) {
      loadedRef.current = from + data.length
      setTimesheets(prev => [...prev, ...data])
    }
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    if (!profile) return
    let active = true
    loadedRef.current = 0
    ;(async () => {
      const { data, count, error } = await dataClient.getTimesheets({ from: 0, to: PAGE_SIZE - 1 })
      if (!active) return
      if (!error && data) {
        loadedRef.current = data.length
        setTimesheets(data)
        if (typeof count === 'number') setTotalCount(count)
      }
      setTimesheetsLoading(false)
    })()
    ;(async () => {
      const [pr, us, lv] = await Promise.all([
        dataClient.getProjects(),
        dataClient.getAllUsers(),
        dataClient.getLeaves(),
      ])
      if (!active) return
      if (!pr.error && pr.data) setProjects(pr.data)
      if (!us.error && us.data) setUsers(us.data)
      if (!lv.error && lv.data) setLeaves(lv.data)
    })()
    return () => { active = false }
  }, [profile])

  const range = presetRange(preset, customStart, customEnd)

  const hasMore = totalCount > 0 && timesheets.length < totalCount

  const visibleRows = useMemo(() => {
    const user: string | null = userFilter === 'me' ? (myId ?? null) : userFilter === 'all' ? null : userFilter
    return selectRows(timesheets, range.start, range.end, projectFilter, user)
  }, [timesheets, range, projectFilter, userFilter, myId])

  const exportVisible = () => {
    const filename = `report_${range.start}_${range.end}.csv`
    exportTimesheetCsv(visibleRows, filename)
    setLastExport({ filename, headers: TIMESHEET_CSV_HEADERS, rows: timesheetCsvRows(visibleRows) })
    toast('Report exported.', 'success')
  }

  const exportMonth = (offset: number) => {
    const start = monthStartOffset(offset)
    const end = monthEndOffset(offset)
    const rows = selectRows(timesheets, start, end, 'all', null)
    const filename = `report_${start.slice(0, 7)}.csv`
    exportTimesheetCsv(rows, filename)
    setLastExport({ filename, headers: TIMESHEET_CSV_HEADERS, rows: timesheetCsvRows(rows) })
    toast('Report exported.', 'success')
  }

  const exportLast3 = () => {
    const headers = ['Month', 'Date', 'User', 'Project', 'Type', 'Hours', 'Work Done']
    const data: (string | number)[][] = []
    for (let offset = -1; offset >= -3; offset--) {
      const start = monthStartOffset(offset)
      const end = monthEndOffset(offset)
      selectRows(timesheets, start, end, 'all', null).forEach(t => data.push([start.slice(0, 7), t.log_date, t.profiles?.email || 'Unknown', t.projects?.name || 'Unknown', t.activity_types?.name || 'Unknown', t.hours_worked, t.work_done]))
    }
    const filename = `report_last3_${monthStartOffset(-3).slice(0, 7)}_${monthEndOffset(-1).slice(0, 7)}.csv`
    downloadCSV(filename, headers, data)
    setLastExport({ filename, headers, rows: data })
    toast('Report exported.', 'success')
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
    toast('Report exported.', 'success')
  }

  const exportCustomMonth = () => {
    if (!/^\d{4}-\d{2}$/.test(customMonth || '')) return toast('Enter a month as YYYY-MM.', 'error')
    const start = customMonth + '-01'
    const end = toISODate(new Date(new Date(customMonth + '-01T00:00:00').getFullYear(), new Date(customMonth + '-01T00:00:00').getMonth() + 1, 0))
    const rows = selectRows(timesheets, start, end, 'all', null)
    const filename = `report_${customMonth}.csv`
    exportTimesheetCsv(rows, filename)
    setLastExport({ filename, headers: TIMESHEET_CSV_HEADERS, rows: timesheetCsvRows(rows) })
    toast('Report exported.', 'success')
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
      const iso = toISODate(d)
      const hasEntry = timesheets.some(t => t.user_id === myId && t.log_date === iso)
      const onLeave = leaves.some(l => l.user_id === myId && l.leave_date === iso)
      if (!hasEntry && !onLeave) days.push(iso)
    }
    return days
  }, [timesheets, leaves, myId])

  const handleLogout = async () => {
    await authClient.signOut()
    router.replace('/')
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
        Loading…
      </div>
    </div>
  )
  if (!profile) return null

  const presetSelect = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="w-auto">
        <option value="this">This Month</option>
        <option value="last">Last Month</option>
        <option value="prev2">2 Months Ago</option>
        <option value="prev3">3 Months Ago</option>
        <option value="custom">Custom Range</option>
      </Select>
      {preset === 'custom' && (
        <>
          <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-auto" />
          <span className="text-sm text-slate-400">to</span>
          <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-auto" />
        </>
      )}
      <Badge tone="blue">{range.start} → {range.end}</Badge>
    </div>
  )

  const projectSelect = (value: string, onChange: (v: string) => void, allLabel = 'All Projects') => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto">
      <option value="all">{allLabel}</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  )

  return (
    <AppShell
      name={profile.name}
      email={profile.email}
      department={profile.department}
      role={role}
      active="reports"
      onLogout={handleLogout}
    >
      <PageHeader
        title="Reports"
        subtitle="Hours, summaries, comparisons, and CSV exports."
        actions={
          <Button variant="secondary" onClick={exportVisible}>
            <IconDownload className="h-4 w-4" /> Export Current View
          </Button>
        }
      />

      <SegmentedTabs
        value={tab}
        onChange={(t) => {
          const params = new URLSearchParams(searchParams?.toString() ?? window.location.search)
          params.set('tab', t)
          router.replace(`?${params.toString()}`)
        }}
        className="mb-6"
        options={[
          { key: 'myhours', label: 'My Hours', icon: <IconClock className="h-4 w-4" /> },
          { key: 'summaries', label: 'Summaries', icon: <IconChart className="h-4 w-4" /> },
          ...(isReportRole ? [{ key: 'reports' as const, label: 'Reports', icon: <IconDocument className="h-4 w-4" /> }] : []),
          { key: 'compare', label: 'Compare', icon: <IconScale className="h-4 w-4" /> },
          { key: 'missing', label: 'My Missing', icon: <IconCalendar className="h-4 w-4" /> },
        ]}
      />

      {tab === 'myhours' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total hours" value={`${fmtHours(sumHours(visibleRows))} hrs`} icon={<IconClock className="h-5 w-5" />} />
            <StatCard label="Entries" value={visibleRows.length} icon={<IconDocument className="h-5 w-5" />} accent="blue" />
            <StatCard
              label="Period"
              value={range.start}
              sub={`→ ${range.end}`}
              icon={<IconCalendar className="h-5 w-5" />}
              accent="amber"
            />
          </div>

          <Card
            title="My Hours"
            subtitle={`${visibleRows.length} entr${visibleRows.length === 1 ? 'y' : 'ies'} in selected period`}
            icon={<IconClock className="h-4.5 w-4.5" />}
            bodyClassName="p-0"
            actions={
              <>
                {presetSelect}
                {projectSelect(projectFilter, setProjectFilter)}
              </>
            }
          >
            {timesheetsLoading && timesheets.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
                Loading entries…
              </div>
            ) : visibleRows.length === 0 ? (
              <EmptyState
                className="m-5"
                icon={<IconClock className="h-5 w-5" />}
                title="No entries in this period"
                description="Try a different date range or project filter."
              />
            ) : (
              <>
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b border-slate-100 bg-slate-50">
                      <tr>
                        <Th>Date</Th>
                        <Th>Project</Th>
                        <Th>Type</Th>
                        <Th className="text-right">Hrs</Th>
                        <Th>Work Done</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleRows.map(t => (
                        <tr key={t.id} className="transition-colors hover:bg-slate-50/70">
                          <Td className="whitespace-nowrap tabular-nums">{t.log_date}</Td>
                          <Td className="font-medium text-slate-800">{t.projects?.name}</Td>
                          <Td className="text-slate-500">{t.activity_types?.name || '—'}</Td>
                          <Td className="text-right tabular-nums">{t.hours_worked}</Td>
                          <Td className="max-w-xs truncate text-slate-500">{t.work_done}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMore && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
                    <span>
                      Showing {timesheets.length} of {totalCount} entries — totals update as more load.
                    </span>
                    <Button variant="secondary" size="sm" onClick={loadMoreTimesheets} disabled={loadingMore}>
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>

          {lastExport && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <span className="flex items-center gap-2">
                <IconCheckCircle className="h-4.5 w-4.5" />
                Last export: <span className="font-medium">{lastExport.filename}</span>
              </span>
              <Button variant="secondary" size="sm" onClick={() => downloadCSV(lastExport.filename, lastExport.headers, lastExport.rows)}>
                Download again
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === 'summaries' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card
            title="My Summary"
            subtitle={`${range.start} → ${range.end}`}
            icon={<IconUsers className="h-4.5 w-4.5" />}
            actions={<div className="flex flex-wrap items-center gap-2">{presetSelect}{projectSelect(projectFilter, setProjectFilter)}</div>}
          >
            <div className="flex items-end gap-6">
              <div>
                <div className="text-4xl font-bold tabular-nums tracking-tight text-primary-700">
                  {fmtHours(sumHours(mySummaryRows))}
                  <span className="ml-1 text-lg font-medium text-slate-400">hrs</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {mySummaryRows.length} entr{mySummaryRows.length === 1 ? 'y' : 'ies'}
                </p>
              </div>
              <div className="mb-1.5">
                <Badge tone="green">
                  <IconCheck className="h-3 w-3" /> Logged
                </Badge>
              </div>
            </div>
          </Card>

          <Card
            title="Project Summary"
            subtitle="Hours per user on a project"
            icon={<IconChart className="h-4.5 w-4.5" />}
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {presetSelect}
              <Select value={summaryProject} onChange={(e) => setSummaryProject(e.target.value)} className="w-auto">
                <option value="">Select Project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            {summaryProject ? (
              projectSummaryRows.length === 0 ? (
                <EmptyState
                  className="py-6"
                  icon={<IconChart className="h-5 w-5" />}
                  title="No hours for this project in the period"
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/60">
                      <tr>
                        <Th>User</Th>
                        <Th className="text-right">Hours</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {projectSummaryRows.map((r, i) => (
                        <tr key={i} className="transition-colors hover:bg-slate-50/70">
                          <Td className="text-slate-600">{r.email}</Td>
                          <Td className="text-right tabular-nums font-medium text-slate-800">
                            {fmtHours(r.hours)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <EmptyState
                className="py-6"
                icon={<IconChart className="h-5 w-5" />}
                title="Pick a project"
                description="Choose a project to see hours per user."
              />
            )}
          </Card>
        </div>
      )}

      {tab === 'reports' && isReportRole && (
        <div className="space-y-6">
          <Card
            title="Group Report"
            subtitle="Export filtered hours for all users"
            icon={<IconUsers className="h-4.5 w-4.5" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {presetSelect}
                {projectSelect(projectFilter, setProjectFilter)}
                <Select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="w-auto">
                  <option value="all">All Users</option>
                  <option value="me">Me</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </Select>
              </div>
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Total: <strong className="tabular-nums text-slate-900">{fmtHours(sumHours(visibleRows))} hrs</strong>{' '}
                across {visibleRows.length} entr{visibleRows.length === 1 ? 'y' : 'ies'}
              </p>
              <Button variant="success" onClick={exportVisible}>
                <IconDownload className="h-4 w-4" /> Export CSV
              </Button>
            </div>
          </Card>

          <Card
            title="User Report"
            subtitle="Per-user export for a selected period"
            icon={<IconUsers className="h-4.5 w-4.5" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={userFilter === 'all' ? '' : userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="w-auto"
                >
                  <option value="">Select User…</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </Select>
                {presetSelect}
              </div>
            }
          >
            {userFilter && userFilter !== 'all' && userFilter !== 'me' ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Exporting entries for the selected user in the chosen period.
                </p>
                <Button variant="success" onClick={exportVisible}>
                  <IconDownload className="h-4 w-4" /> Export User CSV
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Select a user to export their entries.</p>
            )}
          </Card>

          <Card
            title="Monthly Exports"
            subtitle="Pre-built exports by calendar month"
            icon={<IconCalendar className="h-4.5 w-4.5" />}
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => exportMonth(0)}>This Month</Button>
              <Button variant="secondary" size="sm" onClick={() => exportMonth(-1)}>Last Month</Button>
              <Button variant="secondary" size="sm" onClick={() => exportMonth(-2)}>2 Months Ago</Button>
              <Button variant="secondary" size="sm" onClick={() => exportMonth(-3)}>3 Months Ago</Button>
              <Button variant="secondary" size="sm" onClick={exportLast3}>Last 3 (one file)</Button>
              <Button variant="secondary" size="sm" onClick={exportLast3Total}>Last 3 Total</Button>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
              <Field label="Custom Month" className="w-44">
                <Input type="month" value={customMonth} onChange={(e) => setCustomMonth(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={exportCustomMonth}>
                <IconDownload className="h-4 w-4" /> Export Month
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'compare' && (
        <Card
          title="Compare Project Across Periods"
          subtitle="Total hours for a project between two periods"
          icon={<IconScale className="h-4.5 w-4.5" />}
        >
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Select value={compareProject} onChange={(e) => setCompareProject(e.target.value)} className="w-auto">
              <option value="">Select Project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={compareA} onChange={(e) => setCompareA(e.target.value as Preset)} className="w-auto">
              <option value="this">This Month</option>
              <option value="last">Last Month</option>
              <option value="prev2">2 Months Ago</option>
              <option value="prev3">3 Months Ago</option>
            </Select>
            <span className="text-sm font-medium text-slate-400">vs</span>
            <Select value={compareB} onChange={(e) => setCompareB(e.target.value as Preset)} className="w-auto">
              <option value="this">This Month</option>
              <option value="last">Last Month</option>
              <option value="prev2">2 Months Ago</option>
              <option value="prev3">3 Months Ago</option>
            </Select>
          </div>
          {compareProject ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Period A"
                value={`${fmtHours(compareRows.a)} hrs`}
                sub={compareRows.aLabel}
                icon={<IconClock className="h-5 w-5" />}
                accent="blue"
              />
              <StatCard
                label="Period B"
                value={`${fmtHours(compareRows.b)} hrs`}
                sub={compareRows.bLabel}
                icon={<IconClock className="h-5 w-5" />}
                accent="amber"
              />
              <StatCard
                label="Change"
                value={`${compareRows.b - compareRows.a >= 0 ? '+' : ''}${fmtHours(compareRows.b - compareRows.a)} hrs`}
                sub={compareRows.b - compareRows.a >= 0 ? 'up from period A' : 'down from period A'}
                icon={<IconScale className="h-5 w-5" />}
                accent={compareRows.b - compareRows.a >= 0 ? 'green' : 'primary'}
              />
            </div>
          ) : (
            <EmptyState
              icon={<IconScale className="h-5 w-5" />}
              title="Pick a project to compare"
              description="Choose a project and two periods to see the change in hours."
            />
          )}
        </Card>
      )}

      {tab === 'missing' && (
        <Card
          title={`My Missing Days — ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}`}
          subtitle="Weekdays so far this month with no entry and no leave marker"
          icon={<IconCalendar className="h-4.5 w-4.5" />}
        >
          {missingDays.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/60">
                  <tr>
                    <Th>Date</Th>
                    <Th>Weekday</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {missingDays.map(d => (
                    <tr key={d}>
                      <Td className="tabular-nums">{d}</Td>
                      <Td className="text-slate-500">
                        {new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-medium text-emerald-700">
              <IconCheckCircle className="h-5 w-5" />
              All weekdays covered so far — nice work!
            </div>
          )}
        </Card>
      )}
    </AppShell>
  )
}

function ReportsPageWithSuspense() {
  return (
    <Suspense fallback={null}>
      <ReportsPage />
    </Suspense>
  )
}

export default ReportsPageWithSuspense

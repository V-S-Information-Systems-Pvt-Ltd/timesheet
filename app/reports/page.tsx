// app/reports/page.tsx
'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import { dataClient } from '@/lib/data/client'
import { LeaveEntry, Project, Timesheet, User } from '../types'
import { useAsyncData } from '../hooks'
import { AppShell, Badge, Button, Card, EmptyState, Field, Input, PageHeader, SegmentedTabs, Select, StatCard, Td, Th } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCalendar, IconChart, IconCheck, IconCheckCircle, IconClock, IconDocument, IconDownload, IconScale, IconUsers } from '@/app/components/icons'
import { monthEndOffset, monthStartOffset, presetRange, toISODate, type Preset } from '@/lib/dates'
import { downloadCSV } from '@/lib/csv'
import { fmtHours, selectRows, sumHours } from '@/lib/reports'

/** Timesheet rows fetched per page in the reports view. */
const PAGE_SIZE = 1000

/** Initial/default values for report settings serialised to the URL. */
const REPORT_DEFAULTS: Record<string, string> = {
  preset: 'this',
  customStart: '',
  customEnd: '',
  project: 'all',
  user: 'me',
  summary: '',
  compareProject: '',
  compareA: 'this',
  compareB: 'last',
  month: '',
}

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

  // Snapshot of query params at first render, used to hydrate report state so
  // filtered views are shareable and survive refresh. Empty/default values are
  // deliberately omitted from the URL to keep it clean.
  const initialParams = useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const PRESETS: Preset[] = ['this', 'last', 'prev2', 'prev3', 'today', 'yesterday', 'week', '7days', 'custom']
  const presetFromUrl = (key: string): Preset => {
    const v = initialParams.get(key)
    return v && (PRESETS as string[]).includes(v) ? (v as Preset) : 'this'
  }

  const [preset, setPreset] = useState<Preset>(presetFromUrl('preset'))
  const [customStart, setCustomStart] = useState(initialParams.get('customStart') ?? '')
  const [customEnd, setCustomEnd] = useState(initialParams.get('customEnd') ?? '')
  const [projectFilter, setProjectFilter] = useState(initialParams.get('project') ?? 'all')
  const [userFilter, setUserFilter] = useState<'me' | 'all' | string>(initialParams.get('user') ?? 'me')
  const [summaryProject, setSummaryProject] = useState(initialParams.get('summary') ?? '')
  const [compareProject, setCompareProject] = useState(initialParams.get('compareProject') ?? '')
  const [compareA, setCompareA] = useState<Preset>(presetFromUrl('compareA'))
  const [compareB, setCompareB] = useState<Preset>(presetFromUrl('compareB'))
  const [customMonth, setCustomMonth] = useState(initialParams.get('month') ?? '')
  const [lastExport, setLastExport] = useState<{ filename: string; url: string } | null>(null)

  const [timesheetsError, setTimesheetsError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const isReportRole = profile?.permission_role === 'admin' || profile?.permission_role === 'co'
  const myId = profile?.id
  const role = profile?.role ?? 'user'

  // Keep shareable report settings in the URL so filtered views survive refresh
  // and can be distributed as links. Only non-default values are serialised;
  // the existing `tab` param is preserved.
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    const desired: Record<string, string> = {
      preset,
      customStart,
      customEnd,
      project: projectFilter,
      user: userFilter,
      summary: summaryProject,
      compareProject,
      compareA,
      compareB,
      month: customMonth,
    }
    for (const [key, val] of Object.entries(desired)) {
      if (val === '' || val === REPORT_DEFAULTS[key]) params.delete(key)
      else params.set(key, val)
    }
    const qs = params.toString()
    if (qs !== (searchParams?.toString() ?? '')) {
      router.replace(`?${qs}`, { scroll: false })
    }
  }, [
    preset, customStart, customEnd, projectFilter, userFilter, summaryProject,
    compareProject, compareA, compareB, customMonth, searchParams, router,
  ])

  useEffect(() => {
    authClient.getSession().then(async ({ user }) => {
      if (!user) {
        router.replace('/')
        return
      }
      const { data: profileData } = await dataClient.getProfile(user.id)
      // No profile (fetch failure / RLS denial): route to the dashboard, which
      // owns account-state display (pending approval / load error) — rendering
      // here would strand the user on a blank page.
      if (!profileData || !profileData.is_active) {
        router.replace('/dashboard')
        return
      }
      setProfile(profileData)
      setLoading(false)
    })
  }, [router])

  // Timesheets load in pages so the reports view never pulls the whole table
  // into the client at once; the other reference data is bounded by RLS or
  // an explicit limit.
  const loadedRef = useRef(0)

  const fetchInitialTimesheets = useCallback(async () => {
    setTimesheetsLoading(true)
    setTimesheetsError(null)
    loadedRef.current = 0
    const { data, count, error } = await dataClient.getTimesheets({ from: 0, to: PAGE_SIZE - 1 })
    if (error) {
      setTimesheetsError(error || 'Failed to load timesheet entries.')
    } else if (data) {
      loadedRef.current = data.length
      setTimesheets(data)
      if (typeof count === 'number') setTotalCount(count)
    }
    setTimesheetsLoading(false)
  }, [])

  const loadMoreTimesheets = useCallback(async () => {
    setLoadingMore(true)
    setLoadMoreError(null)
    const from = loadedRef.current
    const { data, error } = await dataClient.getTimesheets({ from, to: from + PAGE_SIZE - 1 })
    if (error) {
      setLoadMoreError(error || 'Failed to load more entries.')
    } else if (data) {
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
      if (error) {
        setTimesheetsError(error || 'Failed to load timesheet entries.')
      } else if (data) {
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

  const triggerServerDownload = (url: string, filename?: string) => {
    const a = document.createElement('a')
    a.href = url
    if (filename) a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const visibleRows = useMemo(() => {
    const user: string | null = userFilter === 'me' ? (myId ?? null) : userFilter === 'all' ? null : userFilter
    return selectRows(timesheets, range.start, range.end, projectFilter, user)
  }, [timesheets, range, projectFilter, userFilter, myId])

  const exportVisible = () => {
    try {
      setIsExporting(true)
      const user: string | null = userFilter === 'me' ? (myId ?? null) : userFilter === 'all' ? null : userFilter
      const filename = `report_${range.start}_${range.end}.csv`
      const url = `/api/data/reports/export?from=${encodeURIComponent(range.start)}&to=${encodeURIComponent(range.end)}&project=${encodeURIComponent(projectFilter)}&user=${encodeURIComponent(user ?? 'all')}`
      triggerServerDownload(url, filename)
      setLastExport({ filename, url })
      toast('Report export started.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  const exportMonth = (offset: number) => {
    try {
      setIsExporting(true)
      const start = monthStartOffset(offset)
      const end = monthEndOffset(offset)
      const filename = `report_${start.slice(0, 7)}.csv`
      const url = `/api/data/reports/export?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&project=all&user=all`
      triggerServerDownload(url, filename)
      setLastExport({ filename, url })
      toast('Report export started.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  const exportLast3 = () => {
    try {
      setIsExporting(true)
      const start = monthStartOffset(-3)
      const end = monthEndOffset(-1)
      const filename = `report_last3_${monthStartOffset(-3).slice(0, 7)}_${monthEndOffset(-1).slice(0, 7)}.csv`
      const url = `/api/data/reports/export?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&project=all&user=all`
      triggerServerDownload(url, filename)
      setLastExport({ filename, url })
      toast('Report export started.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  const exportLast3Total = async () => {
    try {
      setIsExporting(true)
      const start = monthStartOffset(-3)
      const end = monthEndOffset(-1)
      const res = await fetch(`/api/data/reports?groupBy=user&from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`)
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not fetch summary totals.')
      const byGroup: Array<{ label: string; hours: number }> = json.data?.byGroup || []
      const headers = ['User', 'Total Hours']
      const data = byGroup.map(b => [b.label, Math.round(Number(b.hours) * 100) / 100])
      const filename = `report_last3_total_${start.slice(0, 7)}_${end.slice(0, 7)}.csv`
      downloadCSV(filename, headers, data)
      toast('Report exported.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  const exportCustomMonth = () => {
    if (!/^\d{4}-\d{2}$/.test(customMonth || '')) return toast('Enter a month as YYYY-MM.', 'error')
    try {
      setIsExporting(true)
      const start = customMonth + '-01'
      const end = toISODate(new Date(new Date(customMonth + '-01T00:00:00').getFullYear(), new Date(customMonth + '-01T00:00:00').getMonth() + 1, 0))
      const filename = `report_${customMonth}.csv`
      const url = `/api/data/reports/export?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&project=all&user=all`
      triggerServerDownload(url, filename)
      setLastExport({ filename, url })
      toast('Report export started.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  // Summaries
  const mySummaryRows = useMemo(() => {
    if (!myId) return []
    return selectRows(timesheets, range.start, range.end, projectFilter, myId)
  }, [timesheets, range, projectFilter, myId])

  const { data: projectSummaryData, loading: projectSummaryLoading } = useAsyncData<Array<{ email: string; hours: number }>>(
    async () => {
      if (!summaryProject) return { data: [], error: null }
      const res = await dataClient.getReportTotals({
        project: summaryProject,
        from: range.start,
        to: range.end,
        groupBy: 'user',
      })
      if (res.error) return { data: [], error: { message: res.error } }
      const rows = res.data?.byGroup
        ? res.data.byGroup.map(b => ({ email: b.label, hours: Number(b.hours) || 0 })).sort((a, b) => b.hours - a.hours)
        : []
      return { data: rows, error: null }
    },
    [summaryProject, range.start, range.end]
  )
  const projectSummaryRows = summaryProject ? (projectSummaryData ?? []) : []

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

  // UI date labels use the viewer's locale; local date strings (ISO YYYY-MM-DD)
  // are left untouched because they feed server queries and CSV export.
  const locale = typeof navigator !== 'undefined' ? (navigator.language || 'en-US') : 'en-US'
  const monthYear = new Date().toLocaleString(locale, { month: 'long', year: 'numeric' })
  const weekdayName = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long' })

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex items-center gap-2 text-sm text-slate-600">
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
          <span className="text-sm text-slate-600">to</span>
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
      isActive={profile.is_active}
      onLogout={handleLogout}
    >
      <PageHeader
        title="Reports"
        subtitle="Hours, summaries, comparisons, and CSV exports."
        actions={
          <Button variant="secondary" onClick={exportVisible} disabled={isExporting}>
            <IconDownload className="h-4 w-4" /> {isExporting ? 'Exporting…' : 'Export Current View'}
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPreset('today')}>Today</Button>
            <Button variant="secondary" size="sm" onClick={() => setPreset('yesterday')}>Yesterday</Button>
            <Button variant="secondary" size="sm" onClick={() => setPreset('week')}>This Week</Button>
            <Button variant="secondary" size="sm" onClick={() => setPreset('7days')}>Last 7 Days</Button>
            <Button variant="secondary" size="sm" onClick={() => setPreset('this')}>This Month</Button>
            <Button variant="secondary" size="sm" onClick={() => setPreset('last')}>Last Month</Button>
            <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="w-auto">
              <option value="this">This Month</option>
              <option value="last">Last Month</option>
              <option value="prev2">2 Months Ago</option>
              <option value="prev3">3 Months Ago</option>
              <option value="custom">Custom Range</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="7days">Last 7 Days</option>
            </Select>
          </div>
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
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-600">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
                Loading entries…
              </div>
            ) : timesheetsError ? (
              <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                <div className="flex items-center justify-between gap-3">
                  <span>{timesheetsError}</span>
                  <Button variant="secondary" size="sm" onClick={fetchInitialTimesheets}>
                    Retry
                  </Button>
                </div>
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
                          <Td className="text-slate-600">{t.activity_types?.name || '—'}</Td>
                          <Td className="text-right tabular-nums">{t.hours_worked}</Td>
                          <Td className="max-w-xs truncate text-slate-600">{t.work_done}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMore && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
                    <div className="space-y-1">
                      <span>
                        Showing {timesheets.length} of {totalCount} entries — totals update as more load.
                      </span>
                      {loadMoreError && (
                        <p className="text-xs font-medium text-rose-600">{loadMoreError}</p>
                      )}
                    </div>
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
              <Button variant="secondary" size="sm" onClick={() => triggerServerDownload(lastExport.url, lastExport.filename)}>
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
                  <span className="ml-1 text-lg font-medium text-slate-600">hrs</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
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
              projectSummaryLoading ? (
                <div className="flex items-center justify-center py-10 text-xs text-slate-600">
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
                  Loading summary…
                </div>
              ) : projectSummaryRows.length === 0 ? (
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
               <Button variant="success" onClick={exportVisible} disabled={isExporting}>
                 <IconDownload className="h-4 w-4" /> {isExporting ? 'Exporting…' : 'Export CSV'}
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
                 <Button variant="success" onClick={exportVisible} disabled={isExporting}>
                   <IconDownload className="h-4 w-4" /> {isExporting ? 'Exporting…' : 'Export User CSV'}
                 </Button>
               </div>
             ) : (
               <p className="text-sm text-slate-600">Select a user to export their entries.</p>
             )}
           </Card>
 
           <Card
             title="Monthly Exports"
             subtitle="Pre-built exports by calendar month"
             icon={<IconCalendar className="h-4.5 w-4.5" />}
           >
             <div className="flex flex-wrap gap-2">
               <Button variant="secondary" size="sm" onClick={() => exportMonth(0)} disabled={isExporting}>This Month</Button>
               <Button variant="secondary" size="sm" onClick={() => exportMonth(-1)} disabled={isExporting}>Last Month</Button>
               <Button variant="secondary" size="sm" onClick={() => exportMonth(-2)} disabled={isExporting}>2 Months Ago</Button>
               <Button variant="secondary" size="sm" onClick={() => exportMonth(-3)} disabled={isExporting}>3 Months Ago</Button>
               <Button variant="secondary" size="sm" onClick={exportLast3} disabled={isExporting}>Last 3 (one file)</Button>
               <Button variant="secondary" size="sm" onClick={exportLast3Total} disabled={isExporting}>Last 3 Total</Button>
             </div>
             <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
               <Field label="Custom Month" className="w-44">
                 <Input type="month" value={customMonth} onChange={(e) => setCustomMonth(e.target.value)} />
               </Field>
               <Button variant="secondary" onClick={exportCustomMonth} disabled={isExporting}>
                 <IconDownload className="h-4 w-4" /> {isExporting ? 'Exporting…' : 'Export Month'}
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
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="7days">Last 7 Days</option>
              <option value="this">This Month</option>
              <option value="last">Last Month</option>
              <option value="prev2">2 Months Ago</option>
              <option value="prev3">3 Months Ago</option>
            </Select>
            <span className="text-sm font-medium text-slate-600">vs</span>
            <Select value={compareB} onChange={(e) => setCompareB(e.target.value as Preset)} className="w-auto">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="7days">Last 7 Days</option>
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
          title={`My Missing Days — ${monthYear}`}
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
                      <Td className="text-slate-600">
                        {weekdayName(d)}
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

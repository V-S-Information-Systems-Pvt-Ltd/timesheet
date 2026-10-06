// app/dashboard/report-export.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { User } from '../types'
import { dataClient } from '@/lib/data/client'
import { readTimesheetHistory } from '@/lib/dashboard-timesheets'
import { downloadCSV } from '@/lib/csv'
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, ACTIVITY_CODES, ACTIVITY_LABELS, ACTIVITIES_BY_TYPE, isEntryType, isActivityCode, type EntryType, type ActivityCode } from '@vsis/contracts'
import { matchesReportClassification, TIMESHEET_CSV_HEADERS, timesheetCsvRows } from '@/lib/reports'
import { Button, Card, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconDocument } from '@/app/components/icons'

export default function ReportExport({
  allUsers,
  isSessionCurrent,
}: {
  allUsers: User[]
  isSessionCurrent: () => boolean
}) {
  const [reportUser, setReportUser] = useState('all')
  const [entryType, setEntryType] = useState<EntryType | 'legacy' | undefined>()
  const [activityCode, setActivityCode] = useState<ActivityCode | undefined>()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [exporting, setExporting] = useState(false)
  const exportLock = useRef(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])

  const generateReport = async () => {
    if (!isSessionCurrent() || exportLock.current) return
    exportLock.current = true
    setExporting(true)
    const current = ++generation.current
    try {
      const history = await readTimesheetHistory(
        query => dataClient.getTimesheets(query, { deduplicate: false }),
        { userId: reportUser === 'all' ? undefined : reportUser, dateFrom: startDate || undefined, dateTo: endDate || undefined },
        () => generation.current === current && isSessionCurrent(),
      )
      if (generation.current !== current || !isSessionCurrent()) return

      const dataToExport = history.filter(t => matchesReportClassification(t, entryType, activityCode))
      if (dataToExport.length === 0) return toast('No data found for selected criteria.', 'info')

      const headers = [...TIMESHEET_CSV_HEADERS]
      const rows = timesheetCsvRows(dataToExport)

      // Keep the selected range or the full data bounds in the filename.
      const dates = dataToExport.map(t => t.log_date).sort()
      const start = startDate || dates[0] || 'all'
      const end = endDate || dates[dates.length - 1] || 'all'
      downloadCSV(`report_${start}_${end}.csv`, headers, rows)
      toast('Report exported.', 'success')
    } catch (error) {
      if (current === generation.current) toast(error instanceof Error ? error.message : 'Could not export complete history.', 'error')
    } finally {
      exportLock.current = false
      setExporting(false)
    }
  }

  return (
    <Card
      title="Generate Reports"
      subtitle="Filter the system and export to CSV"
      icon={<IconDocument className="h-4.5 w-4.5" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="User">
          <Select disabled={exporting} value={reportUser} onChange={(e) => setReportUser(e.target.value)}>
            <option value="all">All Users</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </Select>
        </Field>
        <Field label="Type"><Select disabled={exporting} value={entryType ?? 'all'} onChange={e => { const value = e.target.value; setEntryType(isEntryType(value) || value === 'legacy' ? value : undefined); setActivityCode(undefined) }}>
          <option value="all">All Types</option>{ENTRY_TYPES.map(type => <option key={type} value={type}>{ENTRY_TYPE_LABELS[type]}</option>)}<option value="legacy">Legacy</option>
        </Select></Field>
        <Field label="Activity"><Select disabled={exporting || entryType === 'legacy'} value={activityCode ?? 'all'} onChange={e => setActivityCode(isActivityCode(e.target.value) ? e.target.value : undefined)}>
          <option value="all">All Activities</option>{(entryType && entryType !== 'legacy' ? ACTIVITIES_BY_TYPE[entryType] : ACTIVITY_CODES).map(code => <option key={code} value={code}>{ACTIVITY_LABELS[code]}</option>)}
        </Select></Field>
        <Field label="From">
          <Input disabled={exporting} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="To">
          <Input disabled={exporting} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button disabled={exporting} variant="success" onClick={generateReport} className="w-full">
            <IconDocument className="h-4 w-4" /> {exporting ? 'Loading history…' : 'Export CSV'}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-muted">
        Export includes all history matching these filters, independently of the table page.
      </p>
    </Card>
  )
}

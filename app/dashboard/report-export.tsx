// app/dashboard/report-export.tsx
'use client'

import { useState } from 'react'
import { Timesheet, User } from '../types'
import { downloadCSV } from '@/lib/csv'
import { Button, Card, Field, Input, Select} from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconDocument } from '@/app/components/icons'

export default function ReportExport({
  allUsers,
  timesheets,
}: {
  allUsers: User[]
  timesheets: Timesheet[]
}) {
  const [reportUser, setReportUser] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const generateReport = () => {
    let dataToExport = timesheets

    if (startDate) dataToExport = dataToExport.filter(t => t.log_date >= startDate)
    if (endDate) dataToExport = dataToExport.filter(t => t.log_date <= endDate)
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

  return (
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
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
  )
}

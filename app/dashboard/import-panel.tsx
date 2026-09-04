// app/dashboard/import-panel.tsx
// Admin CSV import for timesheet entries. Column headers follow the reports
// export: Date, User (email), Project, Type (optional), Hours, Work Done.
'use client'

import { useRef, useState } from 'react'
import { importTimesheets, type CsvTimesheetRow } from '../actions'
import { parseCsv } from '@/lib/csv'
import { Card } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconDownload } from '@/app/components/icons'

const HEADER_ALIASES: Record<string, keyof CsvTimesheetRow> = {
  date: 'logDate',
  user: 'email',
  project: 'project',
  type: 'activityType',
  hours: 'hours',
  'work done': 'workDone',
}

export default function ImportPanel({ onChanged }: { onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handleFile = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (parsed.length < 2) {
        toast('CSV needs a header row and at least one data row.', 'error')
        return
      }

      const headers = parsed[0].map(h => h.trim().toLowerCase())
      const colIndex = new Map<keyof CsvTimesheetRow, number>()
      for (const [alias, key] of Object.entries(HEADER_ALIASES)) {
        const idx = headers.indexOf(alias)
        if (idx !== -1) colIndex.set(key, idx)
      }
      const required: (keyof CsvTimesheetRow)[] = ['email', 'logDate', 'project', 'hours', 'workDone']
      const missing = required.filter(k => !colIndex.has(k))
      if (missing.length > 0) {
        toast(`Missing columns: ${missing.join(', ')}.`, 'error')
        return
      }

      const rows: CsvTimesheetRow[] = parsed
        .slice(1)
        .filter(r => r.some(c => c.trim() !== ''))
        .map(r => ({
          email: r[colIndex.get('email')!] ?? '',
          logDate: r[colIndex.get('logDate')!] ?? '',
          project: r[colIndex.get('project')!] ?? '',
          activityType: colIndex.has('activityType') ? (r[colIndex.get('activityType')!] ?? '') : '',
          hours: r[colIndex.get('hours')!] ?? '',
          workDone: r[colIndex.get('workDone')!] ?? '',
        }))

      const result = await importTimesheets(rows)
      if (result.error) toast(result.error, 'error')
      else {
        toast(
          `Imported ${result.imported} entries${result.skipped ? `, skipped ${result.skipped} duplicates` : ''}.`,
          'success'
        )
        const issues = result.errors ?? []
        if (issues.length > 0) {
          const preview = issues.slice(0, 3).join(' · ') + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '')
          toast(`Issues: ${preview}`, 'info')
        }
        onChanged()
      }
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card
      title="Import Timesheets"
      subtitle="CSV columns: Date, User (email), Project, Type (optional), Hours, Work Done"
      icon={<IconDownload className="h-4.5 w-4.5" />}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
        className="block w-full cursor-pointer text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white transition hover:file:bg-primary-700 disabled:opacity-50"
      />
      <p className="mt-2 text-xs text-slate-600">
        Users are matched by email; projects and activity types by exact name. Multiple entries for
        the same user and date are allowed; rows are only skipped if invalid or if they would push
        the daily total above 24 hours.
      </p>
    </Card>
  )
}
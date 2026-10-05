// app/dashboard/import-panel.tsx
// Admin CSV import for timesheet entries. Column headers follow the reports
// export: Date, User (email), Project, Type (optional), Hours, Work Done.
'use client'

import { useState } from 'react'
import { importTimesheets, type CsvTimesheetRow } from '../actions'
import { parseCsv } from '@/lib/csv'
import { Alert, Button, Card, FileField } from '@/app/components/ui'
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

type Pending = { fileName: string; rows: CsvTimesheetRow[] }
type Result = { imported: number; skipped: number; errors: string[] }

export default function ImportPanel({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  // Parsed rows awaiting the user's confirmation (import no longer fires on select).
  const [pending, setPending] = useState<Pending | null>(null)
  // Persistent import summary (replaces the old ephemeral, truncated toast).
  const [result, setResult] = useState<Result | null>(null)

  const parseFile = async (file: File) => {
    setResult(null)
    const parsed = parseCsv(await file.text())
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
    if (rows.length === 0) {
      toast('No data rows found in the file.', 'error')
      return
    }
    setPending({ fileName: file.name, rows })
  }

  const runImport = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const res = await importTimesheets(pending.rows)
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      setResult({ imported: res.imported ?? 0, skipped: res.skipped ?? 0, errors: res.errors ?? [] })
      setPending(null)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Import Timesheets"
      subtitle="CSV columns: Date, User (email), Project, Type (optional), Hours, Work Done"
      icon={<IconDownload className="h-4.5 w-4.5" />}
    >
      <FileField
        label="Timesheet CSV file"
        buttonLabel="Choose CSV…"
        accept=".csv,text/csv"
        disabled={busy}
        onFiles={(files) => {
          if (files[0]) void parseFile(files[0])
        }}
      />

      {pending && (
        <Alert tone="info" className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span>
            <span className="font-medium">{pending.fileName}</span>: {pending.rows.length} row{pending.rows.length === 1 ? '' : 's'} ready to import.
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={runImport} disabled={busy}>{busy ? 'Importing…' : 'Import'}</Button>
          </span>
        </Alert>
      )}

      {result && (
        <Alert tone={result.errors.length > 0 ? 'warning' : 'success'} className="mt-3">
          <p className="font-medium">
            Imported {result.imported} entr{result.imported === 1 ? 'y' : 'ies'}
            {result.skipped ? `, skipped ${result.skipped}` : ''}.
          </p>
          {result.errors.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto text-xs">
              <p className="mb-1 font-medium">{result.errors.length} issue{result.errors.length === 1 ? '' : 's'}:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </Alert>
      )}

      <p className="mt-2 text-xs text-fg-muted">
        Users are matched by email; projects and activity types by exact name. Multiple entries for
        the same user and date are allowed; rows are only skipped if invalid or if they would push
        the daily total above 24 hours.
      </p>
    </Card>
  )
}

// app/dashboard/backup-panel.tsx
// Admin tile: download a JSON backup of all work data, or restore a backup
// file (merge — skips duplicates and any rows that would exceed the 24h cap).
'use client'

import { useRef, useState } from 'react'
import { exportBackup, restoreBackup } from '../actions'
import { Button, Card } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconDownload, IconUpload } from '@/app/components/icons'

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function BackupPanel({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    if (busy) return
    setBusy('export')
    try {
      const { payload, error } = await exportBackup()
      if (error) {
        toast(error, 'error')
        return
      }
      if (!payload) return toast('Nothing to export.', 'info')
      const stamp = payload.exportedAt.slice(0, 10)
      downloadJson(`timesheet-backup-${stamp}.json`, JSON.stringify(payload, null, 2))
      toast('Backup downloaded.', 'success')
    } finally {
      setBusy(null)
    }
  }

  const handleFile = async (file: File) => {
    if (busy) return
    setBusy('import')
    try {
      const text = await file.text()
      if (!confirm('Restore this backup? It is merged into the current data — existing entries and duplicates are kept. This cannot be undone as a batch.')) return
      const { error, created, skipped } = await restoreBackup(text)
      if (error) {
        toast(error, 'error')
        return
      }
      if (created) {
        toast(
          `Restored: ${created.projects} project(s), ${created.activityTypes} type(s), ${created.timesheets} entry(ies), ${created.leaves} leave(s), ${created.reminders} reminder(s), ${created.globalReminders} global reminder(s)${skipped ? ` · ${skipped} skipped` : ''}.`,
          'success'
        )
        onChanged()
      }
      if (fileRef.current) fileRef.current.value = ''
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title="Backup & Restore"
      subtitle="Download a JSON backup of all work data, or merge a backup file back in"
      icon={<IconDownload className="h-4.5 w-4.5" />}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={handleExport} disabled={busy !== null}>
          <IconDownload className="h-4 w-4" />
          {busy === 'export' ? 'Exporting…' : 'Download Backup'}
        </Button>
        <label className="cursor-pointer">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            disabled={busy !== null}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 disabled:opacity-50">
            <IconUpload className="h-4 w-4" />
            {busy === 'import' ? 'Restoring…' : 'Restore Backup…'}
          </span>
        </label>
      </div>
      <p className="mt-2.5 text-xs text-slate-400">
        Backups contain projects, activity types, timesheets, leaves and reminders (users matched by email).
        Restore merges: rows that already exist or would exceed a user&apos;s 24h daily total are skipped.
      </p>
    </Card>
  )
}
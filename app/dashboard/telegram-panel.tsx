// app/dashboard/telegram-panel.tsx
// "Telegram bot commands" panel: for each timesheet entry, renders the
// Telegram bot command a user can copy-paste into the bot so the web app and
// the bot stay in sync when they run in parallel.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { ActivityType, Project, Timesheet } from '../types'
import { dataClient } from '@/lib/data/client'
import { createTimesheetPageReader, type TimesheetPageState } from '@/lib/dashboard-timesheets'
import { buildBotCommand } from '@/lib/telegram'
import { copyText } from '@/lib/clipboard'
import { Alert, Badge, Button, Card, EmptyState, IconButton, LoadingState } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCopy, IconSend } from '@/app/components/icons'

export default function TelegramPanel({
  projects,
  activityTypes,
  userId,
  isAdmin,
  revision,
}: {
  projects: Project[]
  activityTypes: ActivityType[]
  userId?: string
  isAdmin: boolean
  revision: unknown
}) {
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<TimesheetPageState>({ scope: '', rows: [], count: null, loading: true, error: null })
  const [reader] = useState(() => createTimesheetPageReader(query => dataClient.getTimesheets(query, { deduplicate: false }), setState))
  const scope = userId ? `${userId}:${isAdmin}:${page}:${reload}` : ''
  useEffect(() => {
    reader.reset(scope, { from: (page - 1) * 25, to: page * 25 - 1, userId: isAdmin ? undefined : userId })
    if (scope) void reader.refresh()
    return () => reader.invalidate()
  }, [scope, page, userId, isAdmin, reader, revision])
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const typeById = useMemo(() => new Map(activityTypes.map(t => [t.id, t])), [activityTypes])

  // Own entries for everyone; admins additionally see every entry (with a
  // hint that they must append the target user's @handle manually).
  const visible: Timesheet[] = state.scope === scope ? state.rows : []
  const loading = state.scope !== scope || state.loading
  const totalPages = Math.max(1, Math.ceil((state.count ?? 0) / 25))

  const handleCopy = async (command: string) => {
    const ok = await copyText(command)
    toast(ok ? 'Bot command copied.' : 'Could not copy to clipboard.', ok ? 'success' : 'error')
  }

  return (
    <Card
      title="Telegram Bot Commands"
      subtitle="Copy the command for each entry to keep the Telegram bot in sync (entries run in parallel)"
      icon={<IconSend className="h-4.5 w-4.5" />}
    >
      {loading ? <LoadingState label="Loading bot history…" /> : state.error ? (
        <Alert tone="error">{state.error} <Button variant="secondary" size="sm" onClick={() => setReload(n => n + 1)}>Retry</Button></Alert>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconSend className="h-5 w-5" />}
          title="No entries to mirror yet"
          description="Log a time entry above and its Telegram bot command will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {visible.map(t => {
            const project = projectById.get(t.project_id)
            const activityType = t.activity_type_id ? typeById.get(t.activity_type_id) : undefined
            const { command, reason } = buildBotCommand(t, project, activityType)
            const isForeign = isAdmin && t.user_id !== userId

            return (
              <li
                key={t.id}
                className="rounded-xl border border-border bg-muted/60 p-3.5"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <Badge tone="slate">{t.log_date}</Badge>
                  <span className="font-medium text-fg-muted">{project?.name || 'Unknown project'}</span>
                  {activityType && <span className="text-fg-muted">· {activityType.name}</span>}
                  <span className="ml-auto font-semibold text-fg-muted">{t.hours_worked} h</span>
                </div>

                {command ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs text-fg">
                      {command}
                    </code>
                    <IconButton label="Copy" title="Copy command" size="sm" onClick={() => handleCopy(command)} className="min-h-11 min-w-11 shrink-0 md:min-h-9 md:min-w-9">
                      <IconCopy className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                ) : (
                  <Alert tone="warning" className="text-xs">{reason}</Alert>
                )}

                {isForeign && (
                  <p className="mt-1.5 text-[11px] text-fg-muted">
                    Entry by {t.profiles?.email || 'another user'} — append their Telegram @handle after the command if the bot needs it.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" disabled={loading || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</Button>
        <span className="text-xs text-fg-muted">Page {page} of {state.count === null ? '…' : totalPages}</span>
        <Button variant="secondary" size="sm" disabled={loading || Boolean(state.error) || page >= totalPages} onClick={() => setPage(n => n + 1)}>Next</Button>
      </div>
    </Card>
  )
}

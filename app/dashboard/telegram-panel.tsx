// app/dashboard/telegram-panel.tsx
// "Telegram bot commands" panel: for each timesheet entry, renders the
// Telegram bot command a user can copy-paste into the bot so the web app and
// the bot stay in sync when they run in parallel.
'use client'

import { useMemo } from 'react'
import { ActivityType, Project, Timesheet } from '../types'
import { buildBotCommand } from '@/lib/telegram'
import { Badge, Button, Card, EmptyState } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCopy, IconSend } from '@/app/components/icons'

/** Copy text with a clipboard-API fallback for non-secure contexts. */
async function copyText(command: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(command)
    return true
  } catch {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = command
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      textarea.remove()
      return ok
    } catch {
      return false
    }
  }
}

export default function TelegramPanel({
  timesheets,
  projects,
  activityTypes,
  userId,
  isAdmin,
}: {
  timesheets: Timesheet[]
  projects: Project[]
  activityTypes: ActivityType[]
  userId?: string
  isAdmin: boolean
}) {
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const typeById = useMemo(() => new Map(activityTypes.map(t => [t.id, t])), [activityTypes])

  // Own entries for everyone; admins additionally see every entry (with a
  // hint that they must append the target user's @handle manually).
  const visible = timesheets.filter(t => t.user_id === userId || isAdmin)

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
      {visible.length === 0 ? (
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
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge tone="slate">{t.log_date}</Badge>
                  <span className="font-medium text-slate-700">{project?.name || 'Unknown project'}</span>
                  {activityType && <span className="text-slate-400">· {activityType.name}</span>}
                  <span className="ml-auto font-semibold text-slate-700">{t.hours_worked} h</span>
                </div>

                {command ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-300">
                      {command}
                    </code>
                    <Button size="sm" variant="secondary" onClick={() => handleCopy(command)} title="Copy command">
                      <IconCopy className="h-3.5 w-3.5" />
                      <span className="sr-only">Copy</span>
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">{reason}</p>
                )}

                {isForeign && (
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Entry by {t.profiles?.email || 'another user'} — append their Telegram @handle after the command if the bot needs it.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
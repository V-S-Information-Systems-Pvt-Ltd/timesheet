// app/dashboard/leave-panel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { LeaveEntry, User } from '../types'
import { useAsyncData } from '../hooks'
import { Alert, AsyncSection, Badge, Button, Card, DataTable, EmptyState, Field, IconButton, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCalendar, IconTrash } from '@/app/components/icons'
import { addDaysISO, nextMonthISO, rangeDates } from '@/lib/dates'

export default function LeavePanel({
  variant,
  userId,
  users = [],
  today,
}: {
  variant: 'own' | 'admin'
  userId: string
  users?: User[]
  today: string
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  // Admin-only state
  const [targetUser, setTargetUser] = useState('')
  const [summaryMonth, setSummaryMonth] = useState(() => today.slice(0, 7))
  const [summary, setSummary] = useState<{ label: string; days: number }[]>([])
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryReload, setSummaryReload] = useState(0)

  // Leaves load on mount and can be refreshed after mutations.
  const { data: leaves, error: loadError, loading, reload: reloadLeaves } = useAsyncData<LeaveEntry[]>(
    async () => {
      const { data, error } = await dataClient.getLeaves(variant === 'own' ? { userId } : {})
      return { data, error: error ? { message: error } : null }
    },
    [variant, userId]
  )
  const leafRows = leaves ?? []

  // Every trigger refreshes the current month, including mutations started
  // before a month switch. Cleanup prevents stale reads from changing state.
  const loadSummary = useCallback(() => setSummaryReload(n => n + 1), [])

  useEffect(() => {
    if (variant !== 'admin') return
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummaryLoading(Boolean(summaryMonth))
    setSummaryError(null)
    setSummary([])
    if (!summaryMonth) return
    const to = addDaysISO(nextMonthISO(summaryMonth) + '-01', -1)
    void (async () => {
      try {
        const { data, error } = await dataClient.getLeaves({ from: summaryMonth + '-01', to })
        if (!active) return
        if (error) { setSummaryError(error); return }
        const counts = new Map<string, number>()
        ;(data || []).forEach(l => counts.set(l.user_id, (counts.get(l.user_id) || 0) + 1))
        setSummary(Array.from(counts.entries())
          .map(([uid, days]) => ({ label: users.find(u => u.id === uid)?.email || uid, days }))
          .sort((a, b) => b.days - a.days))
      } catch {
        if (active) setSummaryError('Could not load leave summary.')
      } finally {
        if (active) setSummaryLoading(false)
      }
    })()
    return () => { active = false }
  }, [variant, summaryMonth, users, summaryReload])

  const handleMark = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!from || !to) {
      setError('Select a date range.')
      return
    }
    const rows = rangeDates(from, to).map(d => ({
      userId: variant === 'admin' && targetUser ? targetUser : userId,
      leaveDate: d,
      reason: reason.trim(),
    }))
    if (rows.length === 0) {
      setError('Invalid range.')
      return
    }
    const { error } = await dataClient.insertLeaves(rows)
    if (error) {
      toast(error, 'error')
    } else {
      toast(`Marked ${rows.length} leave day(s).`, 'success')
      setFrom('')
      setTo('')
      setReason('')
      reloadLeaves()
      if (variant === 'admin') loadSummary()
    }
  }

  const handleCancel = async (id: string) => {
    const { error } = await dataClient.deleteLeave(id)
    if (error) {
      toast(error, 'error')
    } else {
      reloadLeaves()
      if (variant === 'admin') loadSummary()
      toast('Leave marker removed.', 'success')
    }
  }

  return (
    <Card
      title={variant === 'admin' ? 'Leave Management' : 'Leave'}
      subtitle={
        variant === 'admin'
          ? `Showing up to 1000 markers · Today: ${today}`
          : `Up to 120 of your markers · Today: ${today}`
      }
      icon={<IconCalendar className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleMark} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {variant === 'admin' && (
          <Field label="User" className="sm:col-span-2">
            <Select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} required>
              <option value="">Select User…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </Select>
          </Field>
        )}
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
        </Field>
        <Field label="Reason (optional)" className="sm:col-span-2">
          <Input type="text" placeholder="e.g. Medical leave" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button type="submit" className="sm:col-span-2">
          <IconCalendar className="h-4 w-4" />
          {variant === 'admin' ? 'Set Leave' : 'Mark Leave'}
        </Button>
      </form>

      {error && <Alert tone="error" className="mt-3">{error}</Alert>}

      {variant === 'admin' && (
        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              type="month"
              aria-label="Leave summary month"
              value={summaryMonth}
              onChange={(e) => setSummaryMonth(e.target.value)}
              className="w-auto"
            />
            <Button variant="secondary" size="sm" onClick={loadSummary}>
              Refresh
            </Button>
          </div>
          {summaryError ? (
            <Alert tone="error" className="flex flex-wrap items-center justify-between gap-3">
              <span>Could not load: {summaryError}</span>
              <Button variant="secondary" size="sm" onClick={loadSummary}>Retry</Button>
            </Alert>
          ) : summaryLoading ? (
            <EmptyState className="py-6" title="Loading summary…" />
          ) : summary.length === 0 ? (
            <EmptyState
              className="py-6"
              icon={<IconCalendar className="h-5 w-5" />}
              title="No leave recorded for this month"
            />
          ) : (
            <DataTable
              className="rounded-lg border border-border"
              caption="Monthly leave summary"
              rows={summary}
              rowKey={(_, i) => String(i)}
              columns={[
                { key: 'user', header: 'User', cell: s => s.label },
                {
                  key: 'days', header: 'Leave Days', align: 'center',
                  cell: s => <Badge tone={s.days > 0 ? 'amber' : 'slate'}>{s.days} day{s.days === 1 ? '' : 's'}</Badge>,
                },
              ]}
            />
          )}
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="mb-2 text-xs font-semibold text-fg-subtle">Marked Days</h3>
        <AsyncSection loading={loading} error={loadError} reload={reloadLeaves} skeletonLines={2}>
        {leafRows.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={<IconCalendar className="h-5 w-5" />}
            title="No leave markers"
            description="Use the form above to mark days off."
          />
        ) : (
          <DataTable
            className="rounded-lg border border-border"
            caption="Marked leave days"
            rows={leafRows}
            rowKey={l => l.id}
            columns={[
              { key: 'date', header: 'Date', tdClassName: 'whitespace-nowrap tabular-nums', cell: l => l.leave_date },
              { key: 'reason', header: 'Reason', cell: l => l.reason || '—' },
              {
                key: 'action', header: 'Action', align: 'right',
                cell: l => (
                  <IconButton label="Cancel" size="sm" tone="danger" onClick={() => handleCancel(l.id)} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                    <IconTrash className="h-3.5 w-3.5" />
                  </IconButton>
                ),
              },
            ]}
          />
        )}
        </AsyncSection>
      </div>
    </Card>
  )
}

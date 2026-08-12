// app/dashboard/leave-panel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LeaveEntry, User } from '../types'
import { useAsyncData } from '../hooks'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconCalendar,
  IconTrash,
  Input,
  Select,
  Td,
  Th,
  toast,
} from '@/app/components/ui'
import { nextMonthISO, rangeDates, toISODate } from '@/lib/dates'

const supabase = createClient()

export default function LeavePanel({
  variant,
  userId,
  users = [],
}: {
  variant: 'own' | 'admin'
  userId: string
  users?: User[]
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Admin-only state
  const [targetUser, setTargetUser] = useState('')
  const [summaryMonth, setSummaryMonth] = useState(() => toISODate(new Date()).slice(0, 7))
  const [summary, setSummary] = useState<{ label: string; days: number }[]>([])

  // Leaves load on mount and can be refreshed after mutations.
  const { data: leaves, reload: reloadLeaves } = useAsyncData<LeaveEntry[]>(
    async () => {
      const query = supabase
        .from('leaves')
        .select('*')
        .order('leave_date', { ascending: true })
      if (variant === 'own') query.eq('user_id', userId)
      return query.limit(variant === 'admin' ? 1000 : 120)
    },
    [variant, userId]
  )
  const leafRows = leaves ?? []

  const loadSummary = useCallback(async () => {
    if (!summaryMonth) return
    const next = nextMonthISO(summaryMonth)
    const { data, error } = await supabase
      .from('leaves')
      .select('user_id')
      .gte('leave_date', summaryMonth + '-01')
      .lt('leave_date', next + '-01')
    if (error) {
      setError(error.message)
      return
    }
    const counts = new Map<string, number>()
    ;(data || []).forEach(l => counts.set(l.user_id, (counts.get(l.user_id) || 0) + 1))
    setSummary(
      Array.from(counts.entries())
        .map(([uid, days]) => ({
          label: users.find(u => u.id === uid)?.email || uid,
          days,
        }))
        .sort((a, b) => b.days - a.days)
    )
  }, [summaryMonth, users])

  useEffect(() => {
    if (variant !== 'admin' || !summaryMonth) return
    let active = true
    const next = nextMonthISO(summaryMonth)
    supabase
      .from('leaves')
      .select('user_id')
      .gte('leave_date', summaryMonth + '-01')
      .lt('leave_date', next + '-01')
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setError(error.message)
          return
        }
        const counts = new Map<string, number>()
        ;(data || []).forEach(l => counts.set(l.user_id, (counts.get(l.user_id) || 0) + 1))
        setSummary(
          Array.from(counts.entries())
            .map(([uid, days]) => ({
              label: users.find(u => u.id === uid)?.email || uid,
              days,
            }))
            .sort((a, b) => b.days - a.days)
        )
      })
    return () => { active = false }
  }, [variant, summaryMonth, users])

  const handleMark = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    if (!from || !to) {
      setError('Select a date range.')
      return
    }
    const rows = rangeDates(from, to).map(d => ({
      user_id: variant === 'admin' && targetUser ? targetUser : userId,
      leave_date: d,
      reason: reason.trim(),
    }))
    if (rows.length === 0) {
      setError('Invalid range.')
      return
    }
    const { error } = await supabase.from('leaves').insert(rows)
    if (error) {
      setError(error.message)
      toast(error.message, 'error')
    } else {
      setMessage(`Marked ${rows.length} day(s).`)
      toast(`Marked ${rows.length} leave day(s).`, 'success')
      setFrom('')
      setTo('')
      setReason('')
      reloadLeaves()
      if (variant === 'admin') loadSummary()
    }
  }

  const handleCancel = async (id: string) => {
    setError('')
    const { error } = await supabase.from('leaves').delete().eq('id', id)
    if (error) {
      setError(error.message)
      toast(error.message, 'error')
    } else {
      reloadLeaves()
      if (variant === 'admin') loadSummary()
      toast('Leave marker removed.', 'success')
    }
  }

  const today = toISODate(new Date())

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

      {message && <p className="mt-3 text-sm text-emerald-600">{message}</p>}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {variant === 'admin' && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              type="month"
              value={summaryMonth}
              onChange={(e) => setSummaryMonth(e.target.value)}
              className="w-auto"
            />
            <Button variant="secondary" size="sm" onClick={loadSummary}>
              Refresh
            </Button>
          </div>
          {summary.length === 0 ? (
            <EmptyState
              className="py-6"
              icon={<IconCalendar className="h-5 w-5" />}
              title="No leave recorded for this month"
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/60">
                  <tr>
                    <Th>User</Th>
                    <Th className="text-center">Leave Days</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s, i) => (
                    <tr key={i}>
                      <Td className="text-slate-600">{s.label}</Td>
                      <Td className="text-center">
                        <Badge tone={s.days > 0 ? 'amber' : 'slate'}>{s.days} day{s.days === 1 ? '' : 's'}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Marked Days</h3>
        {leafRows.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={<IconCalendar className="h-5 w-5" />}
            title="No leave markers"
            description="Use the form above to mark days off."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60">
                <tr>
                  <Th>Date</Th>
                  <Th>Reason</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leafRows.map(l => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap tabular-nums">{l.leave_date}</Td>
                    <Td className="text-slate-500">{l.reason || '—'}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleCancel(l.id)} className="px-2 text-rose-600 hover:bg-rose-50">
                        <IconTrash className="h-3.5 w-3.5" />
                        <span className="sr-only">Cancel</span>
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

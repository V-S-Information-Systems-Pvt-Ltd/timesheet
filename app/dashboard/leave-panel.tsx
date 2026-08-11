// app/dashboard/leave-panel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LeaveEntry, User } from '../types'

const supabase = createClient()

function dateToISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function rangeDates(from: string, to: string): string[] {
  const dates: string[] = []
  const cur = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (cur <= end) {
    dates.push(dateToISO(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

function nextMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function LeavePanel({
  variant,
  userId,
  users = [],
}: {
  variant: 'own' | 'admin'
  userId: string
  users?: User[]
}) {
  const [leaves, setLeaves] = useState<LeaveEntry[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Admin-only state
  const [targetUser, setTargetUser] = useState('')
  const [summaryMonth, setSummaryMonth] = useState(() => dateToISO(new Date()).slice(0, 7))
  const [summary, setSummary] = useState<{ label: string; days: number }[]>([])

  const fetchLeaves = useCallback(async () => {
    const query = supabase
      .from('leaves')
      .select('*')
      .order('leave_date', { ascending: true })
    if (variant === 'own') query.eq('user_id', userId)
    const { data, error } = await query.limit(variant === 'admin' ? 1000 : 120)
    if (!error && data) setLeaves(data)
  }, [variant, userId])

  useEffect(() => {
    let active = true
    const query = supabase
      .from('leaves')
      .select('*')
      .order('leave_date', { ascending: true })
    if (variant === 'own') query.eq('user_id', userId)
    query.limit(variant === 'admin' ? 1000 : 120).then(({ data, error }) => {
      if (active && !error && data) setLeaves(data)
    })
    return () => { active = false }
  }, [variant, userId])

  const loadSummary = useCallback(async () => {
    if (!summaryMonth) return
    const next = nextMonth(summaryMonth)
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
    const next = nextMonth(summaryMonth)
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
    if (error) setError(error.message)
    else {
      setMessage(`Marked ${rows.length} day(s).`)
      setFrom('')
      setTo('')
      setReason('')
      fetchLeaves()
      if (variant === 'admin') loadSummary()
    }
  }

  const handleCancel = async (id: string) => {
    setError('')
    const { error } = await supabase.from('leaves').delete().eq('id', id)
    if (error) setError(error.message)
    else {
      fetchLeaves()
      if (variant === 'admin') loadSummary()
    }
  }

  const today = dateToISO(new Date())

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <h2 className="text-xl font-semibold mb-4 text-purple-700">
        {variant === 'admin' ? 'Leave Management' : 'Leave'}
      </h2>

      <form onSubmit={handleMark} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {variant === 'admin' && (
          <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} required className="border p-2 rounded">
            <option value="">Select User...</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        )}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required className="border p-2 rounded" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required className="border p-2 rounded" />
        <input type="text" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="border p-2 rounded" />
        <button type="submit" className="bg-purple-600 text-white py-2 rounded hover:bg-purple-700">
          {variant === 'admin' ? 'Set Leave' : 'Mark Leave'}
        </button>
      </form>

      {message && <p className="text-green-600 text-sm mb-3">{message}</p>}
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {variant === 'admin' && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="month"
              value={summaryMonth}
              onChange={(e) => setSummaryMonth(e.target.value)}
              className="border p-1 rounded text-sm"
            />
            <button onClick={loadSummary} className="text-purple-600 text-sm hover:underline">Refresh</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">User</th>
                <th className="p-2 text-center">Leave Days</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">{s.label}</td>
                  <td className="p-2 text-center">{s.days}</td>
                </tr>
              ))}
              {summary.length === 0 && (
                <tr><td colSpan={2} className="p-2 text-gray-400 text-xs">No leave recorded for this month.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Reason</th>
              <th className="p-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {leaves.map(l => (
              <tr key={l.id} className="border-b">
                <td className="p-2">{l.leave_date}</td>
                <td className="p-2">{l.reason || '—'}</td>
                <td className="p-2 text-center">
                  <button onClick={() => handleCancel(l.id)} className="text-red-600 text-xs hover:underline">Cancel</button>
                </td>
              </tr>
            ))}
            {leaves.length === 0 && (
              <tr><td colSpan={3} className="p-2 text-gray-400 text-xs">No leave markers.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        {variant === 'admin' ? 'Showing all leave markers (latest 1000).' : `Showing up to 120 of your leave markers. Today: ${today}`}
      </p>
    </div>
  )
}

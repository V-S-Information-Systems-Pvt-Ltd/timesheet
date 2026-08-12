// app/change-password/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AppShell,
  Button,
  Field,
  IconKey,
  Input,
  toast,
} from '@/app/components/ui'
import type { UserRole } from '@/app/types'

const supabase = createClient()

export default function ChangePasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<UserRole>('user')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Signed out? Send the user back to the welcome page.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace('/')
        return
      }
      const user = data.session.user
      setName(user.user_metadata?.name || '')
      setEmail(user.email || '')
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (profile) setRole(profile.role as UserRole)
      setLoading(false)
    })
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('You must be signed in.')

      // Verify the current password before allowing the change.
      const check = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (check.error) throw new Error('Current password is incorrect.')

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      setMessage('Password updated successfully.')
      toast('Password updated successfully.', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
        Loading…
      </div>
    </div>
  )

  return (
    <AppShell name={name} email={email} role={role} active="password" onLogout={() => supabase.auth.signOut().then(() => router.replace('/'))} centered>
      <div className="w-full max-w-md">
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 ring-1 ring-inset ring-primary-100">
            <IconKey className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Change Password</h1>
          <p className="mt-1 text-sm text-slate-500">Update the password for your account.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card md:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Current Password">
              <Input
                type="password"
                placeholder="••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </Field>
            <Field label="New Password">
              <Input
                type="password"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm New Password">
              <Input
                type="password"
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </Field>

            <Button type="submit" disabled={busy} className="w-full py-2.5">
              {busy ? 'Please wait…' : 'Update Password'}
            </Button>
          </form>

          {error && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </p>
          )}
          {message && (
            <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
              {message}
            </p>
          )}

          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="mt-5 w-full text-center text-sm text-slate-400 transition hover:text-slate-600"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    </AppShell>
  )
}

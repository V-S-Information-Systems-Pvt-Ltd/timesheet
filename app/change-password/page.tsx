// app/change-password/page.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import { dataClient } from '@/lib/data/client'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { AppShell, Button, Field, Input } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconKey } from '@/app/components/icons'
import type { UserRole } from '@/app/types'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<UserRole>('user')
  const [isActive, setIsActive] = useState(false)
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
    authClient.getSession().then(async ({ user }) => {
      if (!user) {
        router.replace('/')
        return
      }
      const { data: profile } = await dataClient.getProfile(user.id)
      if (profile) {
        setName(profile.name)
        setEmail(profile.email)
        setRole(profile.role)
        setIsActive(profile.is_active)
      } else {
        setEmail(user.email)
      }
      setLoading(false)
    })
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

    // Mirror the server's password policy (lib/password-policy) so the
    // real complexity rules surface client-side without bundling Zod.
    const pwdCheck = validatePasswordPolicy(newPassword)
    if (!pwdCheck.ok) {
      setError(pwdCheck.error ?? 'Password does not meet complexity requirements.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const { error } = await authClient.changePassword(currentPassword, newPassword)
      if (error) throw new Error(error)

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
    <AppShell name={name} email={email} role={role} active="password" isActive={isActive} onLogout={() => authClient.signOut().then(() => router.replace('/'))} centered>
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
                placeholder="At least 8 characters"
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
            <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
              {message}
            </p>
          )}

          <Link
            href="/dashboard"
            className="mt-5 block w-full text-center text-sm text-slate-400 transition hover:text-slate-600"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </AppShell>
  )
}

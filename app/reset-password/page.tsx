'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import { IS_NATIVE } from '@/lib/backend/client'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { BrandMark, Button, Field, Input } from '@/app/components/ui'
import { useBranding } from '@/app/components/branding-provider'
import { toast } from '@/app/components/toast'

const INVALID_MESSAGE = 'This password reset link is invalid or has expired.'

export default function ResetPasswordPage() {
  const router = useRouter()
  const branding = useBranding()
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (IS_NATIVE) {
      const timer = window.setTimeout(() => {
        const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
        const rawToken = new URLSearchParams(hash).get('token')
        setToken(rawToken)
        if (rawToken) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        setReady(Boolean(rawToken))
        setChecking(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }

    const unsubscribe = authClient.onAuthStateChange((user, event) => {
      if (event === 'PASSWORD_RECOVERY' && user) setReady(true)
    })
    void authClient.getPasswordRecoveryState().then(({ ready: recoveryReady }) => {
      if (recoveryReady) setReady(true)
      setChecking(false)
    })
    return unsubscribe
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const check = validatePasswordPolicy(newPassword)
    if (!check.ok) {
      setError(check.error ?? 'Password does not meet complexity requirements.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const result = await authClient.completePasswordReset(newPassword, token ?? undefined)
      if (result.error) throw new Error(result.error)
      toast('Password reset successfully.', 'success')
      router.replace('/?reset=success')
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Unable to complete password reset.'
      setError(text)
      toast(text, 'error')
    } finally {
      setBusy(false)
    }
  }

  const showForm = !checking && ready

  return (
    <main id="main-content" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-accent-50 via-surface to-primary-50 px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary-200/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-brand-red-100/45 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="mb-5 h-16 w-auto mix-blend-multiply" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{branding.appName || 'VSIS Timesheet'}</h1>
          <p className="mt-1.5 text-sm font-medium text-slate-600">Choose a new password</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card md:p-8">
          {checking ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
              Checking reset link…
            </div>
          ) : showForm ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="New Password">
                <Input
                  type="password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm New Password">
                <Input
                  type="password"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <Button type="submit" disabled={busy} className="w-full py-2.5">
                {busy ? 'Please wait…' : 'Reset Password'}
              </Button>
            </form>
          ) : (
            <div className="space-y-4 text-center">
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{INVALID_MESSAGE}</p>
              <p className="text-sm text-slate-600">Request a new link to continue.</p>
              <Link href="/forgot-password" className="block text-sm font-medium text-primary-700 hover:text-primary-800">Request a new reset link</Link>
            </div>
          )}

          {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}
          <Link href="/" className="mt-5 block w-full text-center text-sm text-slate-500 transition hover:text-slate-700">← Back to Sign In</Link>
        </div>
      </div>
    </main>
  )
}

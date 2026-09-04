'use client'

import { useState } from 'react'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'
import { BrandMark, Button, Field, Input } from '@/app/components/ui'
import { useBranding } from '@/app/components/branding-provider'
import { toast } from '@/app/components/toast'

const GENERIC_MESSAGE = 'If an account exists for that email, we sent a password reset link.'

export default function ForgotPasswordPage() {
  const branding = useBranding()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await authClient.requestPasswordReset(email)
      if (result.error) throw new Error(result.error)
      setMessage(GENERIC_MESSAGE)
      setEmail('')
      toast('If the account exists, a reset link is on its way.', 'success')
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Unable to send password reset email.'
      setError(text)
      toast(text, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main-content" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-accent-50 via-surface to-primary-50 px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary-200/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-brand-red-100/45 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="mb-5 h-16 w-auto mix-blend-multiply" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{branding.appName || 'VSIS Timesheet'}</h1>
          <p className="mt-1.5 text-sm font-medium text-slate-600">Reset your password</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card md:p-8">
          <p className="mb-5 text-sm leading-relaxed text-slate-600">
            Enter your work email and we’ll send a secure link if an account matches it.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                spellCheck={false}
              />
            </Field>
            <Button type="submit" disabled={busy} className="w-full py-2.5">
              {busy ? 'Please wait…' : 'Send Reset Link'}
            </Button>
          </form>

          {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}
          {message && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">{message}</p>}

          <Link href="/" className="mt-5 block w-full text-center text-sm text-slate-500 transition hover:text-slate-700">
            ← Back to Sign In
          </Link>
        </div>
      </div>
    </main>
  )
}

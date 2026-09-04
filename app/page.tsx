// app/page.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { BrandMark, Button, Field, Input, SegmentedTabs } from '@/app/components/ui'
import { useBranding } from '@/app/components/branding-provider'
import { toast } from '@/app/components/toast'

export default function WelcomePage() {
  const router = useRouter()
  const branding = useBranding()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const showSignup = true

  // Already signed in? Go straight to the dashboard.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('reset') === 'success') {
      window.setTimeout(() => setMessage('Password reset successfully. You can now sign in.'), 0)
      window.history.replaceState(null, '', window.location.pathname)
    }
    authClient.getSession().then(({ user }) => {
      if (user) router.replace('/dashboard')
    })
  }, [router])

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next)
    setError(null)
    setMessage(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setBusy(true)

    try {
      if (mode === 'signin') {
        const { error } = await authClient.signIn(email, password)
        if (error) throw new Error(error)
        router.replace('/dashboard')
      } else {
        // Mirror the server's password policy (lib/password-policy) so
        // users get the real rules client-side without bundling Zod.
        const pwdCheck = validatePasswordPolicy(password)
        if (!pwdCheck.ok) {
          setError(pwdCheck.error ?? 'Password does not meet complexity requirements.')
          return
        }
        const { error, message: successMsg } = await authClient.signUp(email, password, name)
        if (error) throw new Error(error)
        setPassword('')
        const msg = successMsg || 'Account created! You can now sign in.'
        setMessage(msg)
        toast(msg, 'success')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main-content" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-accent-50 via-surface to-primary-50 px-4 py-10">
      {/* Decorative blurs */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary-200/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-brand-red-100/45 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="mb-5 h-16 w-auto mix-blend-multiply" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{branding.appName || 'VSIS Timesheet'}</h1>
          <p className="mt-1.5 text-sm font-medium text-slate-600">
            Transforming technology to business success.
          </p>
          <p className="mt-1 text-xs text-slate-500">Simple, reliable time tracking for VSIS teams.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card md:p-8">
          {showSignup && (
            <SegmentedTabs
              value={mode}
              onChange={switchMode}
              options={[
                { key: 'signin', label: 'Sign In' },
                { key: 'signup', label: 'Create Account' },
              ]}
              className="mb-6 w-full"
            />
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <Field label="Full Name">
                <Input
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                spellCheck={false}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Field>

            <Button type="submit" disabled={busy} className="w-full py-2.5">
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create Account' : 'Sign In'}
            </Button>

            {mode === 'signin' && (
              <Link
                href="/forgot-password"
                className="block text-center text-sm font-medium text-primary-700 transition hover:text-primary-800"
              >
                Forgot password?
              </Link>
            )}
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

          {mode === 'signup' && (
            <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200">
              Registration is permitted for approved email domains. Accounts configured for automatic activation can sign in immediately.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

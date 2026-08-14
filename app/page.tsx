// app/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import { IS_NATIVE } from '@/lib/backend/client'
import { BrandMark, Button, Field, Input, SegmentedTabs } from '@/app/components/ui'
import { toast } from '@/app/components/toast'

export default function WelcomePage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const showSignup = !IS_NATIVE

  // Already signed in? Go straight to the dashboard.
  useEffect(() => {
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
        if (password.length < 6) {
          setError('Password must be at least 6 characters.')
          return
        }
        const { error } = await authClient.signUp(email, password, name)
        if (error) throw new Error(error)
        setPassword('')
        setMessage('Account created! Check your email to confirm, then sign in.')
        toast('Account created! Check your email to confirm, then sign in.', 'success')
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-primary-50 via-surface to-white px-4 py-10">
      {/* Decorative blurs */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary-200/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-primary-200/40 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="mb-4 h-12 w-12" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">VSIS Time Sheet System</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Track and manage timesheets for VSIS projects.
          </p>
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
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Field>

            <Button type="submit" disabled={busy} className="w-full py-2.5">
              {busy ? 'Please wait…' : 'Sign In'}
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

          {mode === 'signup' && (
            <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-700 ring-1 ring-inset ring-amber-200">
              New accounts must be activated by an admin before logging time.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

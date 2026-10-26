'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BrandMark, ThemeToggle, Alert, LoadingState } from '@/app/components/ui'
import { useBranding } from '@/app/components/branding-provider'

const INVALID_MESSAGE = 'This verification link is invalid or has expired.'

export default function VerifyEmailPage() {
  const branding = useBranding()
  const [state, setState] = useState<'checking' | 'verified' | 'failed'>('checking')
  const [error, setError] = useState(INVALID_MESSAGE)

  useEffect(() => {
    // The token travels in the fragment so it never reaches access logs; it is
    // dropped from the address bar before the request goes out.
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const token = new URLSearchParams(hash).get('token')
    if (token) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    if (!token) {
      const timer = window.setTimeout(() => setState('failed'), 0)
      return () => window.clearTimeout(timer)
    }
    let cancelled = false
    fetch('/api/v1/auth/browser/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { error?: string | null }
        if (cancelled) return
        if (response.ok && !data.error) {
          setState('verified')
        } else {
          setError(data.error || INVALID_MESSAGE)
          setState('failed')
        }
      })
      .catch(() => {
        if (!cancelled) setState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main id="main-content" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-accent-50 via-surface to-primary-50 dark:from-surface dark:to-surface px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="mb-5 h-16 w-auto mix-blend-multiply dark:mix-blend-normal" />
          <h1 className="text-2xl font-bold tracking-tight text-fg">{branding.appName || 'VSIS Timesheet'}</h1>
          <p className="mt-1.5 text-sm font-medium text-fg-muted">Confirm your email address</p>
        </div>

        <div className="rounded-sheet border border-line bg-card p-6 md:p-8">
          {state === 'checking' && <LoadingState label="Confirming your address…" />}
          {state === 'verified' && (
            <Alert tone="success">
              Your email address is confirmed. Sign in to continue; if your account still needs approval, an administrator will activate it.
            </Alert>
          )}
          {state === 'failed' && (
            <div className="space-y-4 text-center">
              <Alert tone="error">{error}</Alert>
              <p className="text-sm text-fg-muted">Resetting your password also confirms your address.</p>
              <Link href="/forgot-password" className="block text-sm font-medium text-primary-text hover:underline">Send a password reset link</Link>
            </div>
          )}
          <Link href="/" className="mt-5 block w-full text-center text-sm text-fg-muted transition hover:text-fg-muted">← Back to Sign In</Link>
        </div>
      </div>
    </main>
  )
}

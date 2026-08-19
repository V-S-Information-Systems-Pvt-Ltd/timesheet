// lib/observability.ts
// Optional Sentry integration. Enabled only when SENTRY_DSN is set.
// Falls back to no-op shims when the SDK is not installed.

let sentryEnabled = false
let Sentry: Record<string, unknown> | null = null

async function loadSentry() {
  if (Sentry) return Sentry
  try {
    const mod = await import('@sentry/nextjs')
    Sentry = mod
    sentryEnabled = true
    return Sentry
  } catch {
    return null
  }
}

export async function initSentry() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  const mod = await loadSentry()
  if (!mod) return
  ;(mod as { init: (opts: { dsn: string; tracesSampleRate: number }) => void }).init({ dsn, tracesSampleRate: 0.1 })
}

export async function captureException(err: unknown, context?: Record<string, unknown>) {
  const mod = await loadSentry()
  if (!mod || !sentryEnabled) return
  ;(mod as { captureException: (err: unknown, opts?: { extra?: Record<string, unknown> }) => void }).captureException(err, context ? { extra: context } : undefined)
}

export async function startSpan(name: string, fn: () => Promise<unknown>) {
  const mod = await loadSentry()
  if (!mod || !sentryEnabled) return fn()
  return ;(mod as { startSpan: (opts: { name: string; op: string }, fn: () => Promise<unknown>) => Promise<unknown> }).startSpan({ name, op: name }, fn)
}

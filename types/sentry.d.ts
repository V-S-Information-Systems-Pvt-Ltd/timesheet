declare module '@sentry/nextjs' {
  export function init(options: { dsn: string; tracesSampleRate: number }): void
  export function captureException(err: unknown, options?: { extra?: Record<string, unknown> }): void
  export function startSpan<T>(options: { name: string; op: string }, fn: () => T): T
}

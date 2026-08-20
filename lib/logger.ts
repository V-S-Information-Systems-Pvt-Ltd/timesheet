// lib/logger.ts
// Minimal structured logger used by server-side code.
// Replaces ad-hoc console.log/console.error. Emits JSON lines to stdout/stderr
// so container runtimes (Datadog, Papertrail, OpenShift) can ingest them.
// requestId/userId passed via `meta` are promoted to top-level fields so they
// are always correlated without extra parsing.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info'

function shouldLog(level: LogLevel) {
  return LEVELS[level] >= LEVELS[minLevel]
}

/** Normalize any thrown value to a usable string (message, not stack-only). */
export function extractError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function setLogLevel(level: LogLevel) {
  minLevel = level
}

function buildEntry(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  // Promote requestId/userId to top-level; the rest stays under `meta`.
  const { requestId, userId, ...rest } = meta ?? {}
  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
  }
  if (requestId !== undefined) entry.requestId = requestId
  if (userId !== undefined) entry.userId = userId
  if (Object.keys(rest).length > 0) entry.meta = rest
  return entry
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (!shouldLog(level)) return
  const entry = buildEntry(level, message, meta)
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
}

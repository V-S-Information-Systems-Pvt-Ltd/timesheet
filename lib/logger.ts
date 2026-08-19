// lib/logger.ts
// Minimal structured logger. Server-side only; safe to import from server
// actions, route handlers, and the migration runner. In development it writes
// human-readable lines to stderr; in production it emits JSON for log
// aggregation. requestId / userId are threaded through logContext so every
// entry carries the trace context (see Phase 5 acceptance: all five fields).

export interface LogFields {
  requestId?: string
  userId?: string
  [key: string]: unknown
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const minLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')) as LogLevel

function fmtDate(): string {
  return new Date().toISOString()
}

export interface LogContext {
  requestId?: string
  userId?: string
  action?: string
}

const contextStack: LogContext[] = []

export function withLogContext(ctx: LogContext): { restore: () => void } {
  contextStack.push(ctx)
  return { restore: () => contextStack.pop() }
}

function collectContext(): LogContext {
  const out: LogContext = {}
  for (const ctx of contextStack) {
    Object.assign(out, ctx)
  }
  return out
}

function write(level: LogLevel, message: string, fields: LogFields = {}) {
  if (levelPriority[level] < levelPriority[minLevel]) return
  const ctx = collectContext()
  const entry = {
    ts: fmtDate(),
    level,
    message,
    ...ctx,
    ...fields,
  }
  const line = process.env.NODE_ENV === 'production' ? JSON.stringify(entry) : `[${entry.ts}] ${level.toUpperCase()} ${message} ${JSON.stringify(fields)}`
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
}

export function extractError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err ?? 'unknown error')
}

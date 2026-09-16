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

/** Replacement marker emitted in place of a redacted metadata value. */
export const REDACTED = '[redacted]'

/**
 * Metadata keys whose value must never reach the log sink: credentials,
 * authorization headers, session/refresh tokens, cookies, provider secrets and
 * whole backup/payload bodies. Keys are matched case-insensitively as substrings
 * so `refreshTokenHash`, `SUPABASE_SERVICE_ROLE_KEY` and `backupBody` are all
 * covered.
 */
const SENSITIVE_META_KEY =
  /pass(word)?|secret|token|authorization|cookie|credential|api[-_]?key|backup|payload|request[-_]?body|response[-_]?body/i

/** Bounds keep unbounded identifiers/bodies from flooding the sink. */
const MAX_META_STRING = 200
const MAX_META_ARRAY = 20
const MAX_META_DEPTH = 4

/**
 * Recursively sanitize structured log metadata: redact sensitive keys, truncate
 * over-long strings and cap array/object depth. Booleans are passed through
 * untouched because they cannot carry a secret (e.g. `hasSecretHeader`).
 */
export function redactLogMeta(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (meta === undefined) return meta
  return scrubObject(meta, 0)
}

function scrubObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth >= MAX_META_DEPTH) return { truncated: true }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined && typeof value !== 'boolean' && SENSITIVE_META_KEY.test(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] = scrubValue(value, depth)
  }
  return out
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_META_STRING ? `${value.slice(0, MAX_META_STRING)}…` : value
  }
  if (Array.isArray(value)) {
    const capped = value.slice(0, MAX_META_ARRAY).map((entry) => scrubValue(entry, depth + 1))
    return value.length > MAX_META_ARRAY
      ? [...capped, `[+${value.length - MAX_META_ARRAY} more]`]
      : capped
  }
  if (value && typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>, depth + 1)
  }
  return value
}

export function setLogLevel(level: LogLevel) {
  minLevel = level
}

function buildEntry(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  // Promote requestId/userId to top-level; the rest stays under `meta`.
  const { requestId, userId, ...rest } = meta ?? {}
  // Redact/bound the remaining metadata for every caller so a stray token,
  // password, cookie or backup body can never reach the sink.
  const safeRest = redactLogMeta(rest) ?? {}
  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
  }
  if (requestId !== undefined) entry.requestId = requestId
  if (userId !== undefined) entry.userId = userId
  if (Object.keys(safeRest).length > 0) entry.meta = safeRest
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

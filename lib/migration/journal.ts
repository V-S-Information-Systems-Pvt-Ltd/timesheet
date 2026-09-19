// lib/migration/journal.ts
// Operator-run artifacts: an exclusive run directory, an append-only JSONL
// journal, a run lock, and redaction of anything secret-shaped before it can
// reach stdout or a journal. Journals deliberately carry no record bodies.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const RUN_ROOT = '.migration-runs'
export const JOURNAL_FILE = 'journal.jsonl'
export const LOCK_FILE = 'lock.json'

export class MigrationRunError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MigrationRunError'
    this.code = code
  }
}

export interface RunJournalEntry {
  at: string
  phase: string
  event: string
  detail: Record<string, unknown> | null
}

export interface RunJournalMeta {
  runId: string
  command: string
  provider?: string
  role?: string
  bundleDigest?: string | null
}

const REDACT_KEY_RE = /(pass(word)?|passwd|secret|token|service_?key|private_?key|signing_?key|credential|connection(_?string)?|database_?url|dsn)/i
const POSTGRES_URL_RE = /postgres(ql)?:\/\/\S+/gi

export function redactString(value: string): string {
  return value.replace(POSTGRES_URL_RE, '[redacted-connection]')
}

/** Deep-redact a value before logging: secret-shaped keys and DSNs never print. */
export function redactResult(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactResult(item))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEY_RE.test(key) ? '[redacted]' : redactResult(item)
    }
    return out
  }
  return value
}

export function writeExclusiveFile(path: string, contents: string): void {
  try {
    // Migration plans, decisions and journals can contain account metadata.
    // Keep newly-created artifacts private on POSIX systems; Windows ignores
    // POSIX mode bits and relies on its normal ACLs.
    writeFileSync(path, contents, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new MigrationRunError('E_ARTIFACT_EXISTS', `Refusing to overwrite existing artifact: ${path}`)
    }
    throw err
  }
}

export function createRunDirectory(root: string, command: string, now: Date): string {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const directory = join(root, `${stamp}-${command}-${randomUUID().slice(0, 8)}`)
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new MigrationRunError('E_RUN_DIR_EXISTS', `Run directory already exists: ${directory}`)
    }
    throw err
  }
  return directory
}

/** Create an operator-specified run directory; an existing path is an error. */
export function createExplicitRunDirectory(directory: string): string {
  try {
    mkdirSync(directory, { recursive: false, mode: 0o700 })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new MigrationRunError('E_RUN_DIR_EXISTS', `Run directory already exists: ${directory}`)
    }
    if (code === 'ENOENT') {
      throw new MigrationRunError('E_RUN_DIR_MISSING', `Run directory parent does not exist: ${directory}`)
    }
    throw err
  }
  return directory
}

export class RunJournal {
  readonly directory: string
  readonly path: string
  private readonly meta: RunJournalMeta
  private readonly now: () => Date
  private lockPath: string | null = null

  private constructor(directory: string, meta: RunJournalMeta, now: () => Date) {
    this.directory = directory
    this.path = join(directory, JOURNAL_FILE)
    this.meta = meta
    this.now = now
  }

  static open(directory: string, meta: RunJournalMeta, now: () => Date = () => new Date()): RunJournal {
    const journal = new RunJournal(directory, meta, now)
    journal.append('run', 'started', {
      command: meta.command,
      provider: meta.provider ?? null,
      role: meta.role ?? null,
      bundleDigest: meta.bundleDigest ?? null,
    })
    return journal
  }

  get runId(): string {
    return this.meta.runId
  }

  append(phase: string, event: string, detail?: Record<string, unknown>): void {
    const entry: RunJournalEntry = {
      at: this.now().toISOString(),
      phase,
      event,
      detail: detail ? (redactResult(detail) as Record<string, unknown>) : null,
    }
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  }

  /** Exclusive run lock: a second process cannot adopt this run directory. */
  acquireLock(): void {
    const path = join(this.directory, LOCK_FILE)
    writeExclusiveFile(
      path,
      `${JSON.stringify({ runId: this.meta.runId, pid: process.pid, at: this.now().toISOString() })}\n`
    )
    this.lockPath = path
  }

  releaseLock(): void {
    if (!this.lockPath) return
    if (existsSync(this.lockPath)) rmSync(this.lockPath)
    this.lockPath = null
  }

  read(): RunJournalEntry[] {
    if (!existsSync(this.path)) return []
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as RunJournalEntry)
  }
}

export function randomRunId(): string {
  return randomUUID()
}

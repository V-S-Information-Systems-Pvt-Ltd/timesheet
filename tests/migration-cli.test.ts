// tests/migration-cli.test.ts
// C01 CLI safety boundary: offline validation, explicit connection inputs,
// read-only sessions, provider/Auth binding, exclusive artifacts and exit codes.
//
// Database behavior is exercised through injected fake sessions that mirror the
// real session's guarantees: only SELECT statements are accepted, and the
// write probe must be rejected. Real live-database evidence is a C02 gate.

import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXIT_CODES, parseArgs, runCli, CliUsageError, type CliDependencies } from '@/lib/migration/cli'
import {
  MigrationConfigError,
  assertAuthDatabaseBinding,
  parsePostgresUrl,
  resolveDatabaseTarget,
} from '@/lib/migration/connections'
import { RUN_ROOT } from '@/lib/migration/journal'
import type { DatabaseSession } from '@/lib/migration/providers/session'
import type { AuthAdminPort } from '@/lib/migration/providers/supabase'
import type { CatalogColumn, CatalogInspection } from '@/lib/migration/schema'
import { ENTITY_ORDER, ENTITY_SPECS, canonicalStringify, type MigrationEntity } from '@/lib/migration/format'
import {
  profileRow,
  projectRow,
  timesheetRow,
  writeBundleFixture,
} from './helpers/migration-fixtures'

const tmpRoot = mkdtempSync(join(tmpdir(), 'vsis-migration-cli-'))
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function tempDir(name: string): string {
  const directory = join(tmpRoot, `${name}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(directory, { recursive: true })
  return directory
}

interface CliRun {
  code: number
  out: string[]
  err: string[]
  json: Record<string, unknown> | null
}

async function run(argv: string[], deps: Partial<CliDependencies> = {}): Promise<CliRun> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, {
    env: {},
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    runRoot: join(tmpRoot, 'runs'),
    ...deps,
  })
  const jsonLine = out.find((line) => line.trim().startsWith('{'))
  let json: Record<string, unknown> | null = null
  if (jsonLine) {
    try {
      json = JSON.parse(out.join('\n')) as Record<string, unknown>
    } catch {
      json = null
    }
  }
  return { code, out, err, json }
}

const KIND_TO_UDT: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  boolean: 'bool',
  date: 'date',
  timestamptz: 'timestamptz',
  decimal: 'numeric',
  integer: 'int4',
  json: 'jsonb',
}

function catalogFor(
  over: Partial<CatalogInspection> & { omitTable?: string; omitColumn?: string } = {}
): CatalogInspection {
  const columns: CatalogColumn[] = []
  const tables: string[] = []
  for (const entity of ENTITY_ORDER) {
    if (entity === over.omitTable) continue
    tables.push(entity)
    for (const spec of ENTITY_SPECS[entity].columns) {
      if (`${entity}.${spec.name}` === over.omitColumn) continue
      columns.push({
        table: entity,
        column: spec.name,
        udtName: KIND_TO_UDT[spec.kind],
        nullable: spec.nullable,
      })
    }
  }
  return {
    tables: [...tables, 'schema_migrations'],
    columns,
    hasAuthSchema: false,
    hasNativeMigrationLedger: true,
    hasSupabaseMigrationLedger: false,
    ...over,
  }
}

interface FakeSession extends DatabaseSession {
  calls: string[]
  closed: boolean
}

function fakeSession(
  over: {
    provider?: 'native' | 'supabase'
    namespace?: string
    runtimeFingerprint?: string
    catalog?: CatalogInspection
    counts?: Record<string, number>
    missingTables?: string[]
    migrations?: string[]
    authUsers?: Array<{ id: string; email: string | null }>
    targetRows?: Partial<Record<MigrationEntity, Record<string, unknown>[]>>
  } = {}
): FakeSession {
  const calls: string[] = []
  const state = { closed: false }
  const catalog = over.catalog ?? catalogFor()
  const session: FakeSession = {
    provider: over.provider ?? 'native',
    displayTarget: '127.0.0.1:5432/test',
    calls,
    get closed() {
      return state.closed
    },
    async identity() {
      calls.push('identity')
      return {
        provider: over.provider ?? 'native',
        namespace: over.namespace ?? 'native:11111111111111111111111111111111',
        runtimeFingerprint: over.runtimeFingerprint ?? 'runtime-a',
        database: 'test',
        serverVersion: '17.6',
        postmasterStartedAt: '2026-09-19 00:00:00+00',
        systemIdentifier: '7000000000000000000',
        displayTarget: '127.0.0.1:5432/test',
      }
    },
    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      calls.push(`query:${text.slice(0, 40)}`)
      if (!/^\s*select\b/i.test(text)) {
        throw new Error('fake session only executes SELECT statements')
      }
      if (text.includes('auth.users')) {
        const id = params?.[0]
        return (over.authUsers ?? []).filter((user) => user.id === id) as unknown as T[]
      }
      if (text.includes('password_hash')) {
        return Object.values(over.targetRows ?? {})
          .flat()
          .filter((row) => typeof row === 'object' && row !== null && 'email' in row)
          .map((row) => ({
            id: String((row as Record<string, unknown>).id),
            email: (row as Record<string, unknown>).email ?? null,
            has_password: false,
          })) as unknown as T[]
      }
      const match = /from public\.([a-z_]+)/.exec(text)
      if (match) {
        const rows = over.targetRows?.[match[1] as MigrationEntity] ?? []
        return rows.map((row) => ({ ...row })) as unknown as T[]
      }
      return []
    },
    async withReadOnlyTransaction<T>(fn: () => Promise<T>): Promise<T> {
      calls.push('withReadOnlyTransaction')
      return fn()
    },
    async assertReadOnly() {
      calls.push('assertReadOnly')
    },
    async inspectCatalog() {
      calls.push('inspectCatalog')
      return catalog
    },
    async countRows(entity: string) {
      calls.push(`countRows:${entity}`)
      return over.counts?.[entity] ?? 0
    },
    async migrationLedger() {
      calls.push('migrationLedger')
      return over.migrations ?? ['0001_initial_schema.sql']
    },
    async close() {
      calls.push('close')
      state.closed = true
    },
  }
  return session
}

function fakeAuthAdmin(
  users: Array<{ id: string; email: string | null; emailConfirmedAt?: string | null }>
): AuthAdminPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async listUsers() {
      calls.push('listUsers')
      return users.map((user) => ({
        id: user.id,
        email: user.email,
        emailConfirmedAt: user.emailConfirmedAt ?? null,
      }))
    },
  }
}

const VALID_BUNDLE_ROWS = {
  profiles: [profileRow()],
  projects: [projectRow()],
  timesheets: [timesheetRow()],
}

describe('CLI argument parsing', () => {
  it('rejects unknown flags and flags missing values', () => {
    expect(() => parseArgs(['validate', '--nope'])).toThrow(CliUsageError)
    expect(() => parseArgs(['validate', '--bundle'])).toThrow(/requires a value/)
    expect(() => parseArgs(['validate', '--json=yes'])).toThrow(/does not take a value/)
  })

  it('supports --flag=value and --flag value', () => {
    const parsed = parseArgs(['validate', '--bundle=dir', '--json'])
    expect(parsed.command).toBe('validate')
    expect(parsed.flags.get('bundle')).toBe('dir')
    expect(parsed.booleans.has('json')).toBe(true)
  })
})

describe('validate command', () => {
  it('validates a well-formed bundle without touching any database', async () => {
    const bundle = writeBundleFixture(tempDir('bundle-ok'), { rows: VALID_BUNDLE_ROWS })
    const result = await run(['validate', '--bundle', bundle.directory, '--json'], {
      openSession: () => {
        throw new Error('validate must not open a database session')
      },
      openAuthAdmin: () => {
        throw new Error('validate must not open an Auth client')
      },
    })
    expect(result.code).toBe(EXIT_CODES.OK)
    expect(result.json?.ok).toBe(true)
    expect((result.json?.entities as unknown[]).length).toBe(ENTITY_ORDER.length)
    expect(result.json?.bundleDigest).toBeTruthy()
  })

  it('creates an exclusive run journal and releases the lock', async () => {
    const bundle = writeBundleFixture(tempDir('bundle-journal'), { rows: VALID_BUNDLE_ROWS })
    const runRoot = join(tempDir('run-root'), RUN_ROOT)
    const result = await run(['validate', '--bundle', bundle.directory], { runRoot })
    expect(result.code).toBe(EXIT_CODES.OK)
    const runDirectories = readdirSync(runRoot)
    expect(runDirectories.length).toBe(1)
    const directory = join(runRoot, runDirectories[0])
    expect(readdirSync(directory).sort()).toEqual(['journal.jsonl', 'result.json'])
    const journal = readFileSync(join(directory, 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"event":"started"')
    expect(journal).toContain('"event":"bundle-valid"')
  })

  it('refuses an existing explicit run directory', async () => {
    const bundle = writeBundleFixture(tempDir('bundle-rundir'), { rows: VALID_BUNDLE_ROWS })
    const explicit = join(tmpRoot, `explicit-run-${Math.random().toString(36).slice(2, 8)}`)
    const first = await run(['validate', '--bundle', bundle.directory, '--run-dir', explicit])
    const second = await run(['validate', '--bundle', bundle.directory, '--run-dir', explicit])
    expect(first.code).toBe(EXIT_CODES.OK)
    expect(second.code).toBe(EXIT_CODES.ENVIRONMENT)
    expect(second.err.join('\n')).toContain('E_RUN_DIR_EXISTS')
  })

  it.each([
    [
      'malformed manifest JSON',
      (dir: string) => writeFileSync(join(dir, 'manifest.json'), '{ not json'),
      'E_MANIFEST_PARSE',
    ],
    [
      'wrong format discriminator',
      (dir: string) => {
        const fixture = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>
        fixture.format = 'some-other-format'
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(fixture))
      },
      'E_FORMAT_DISCRIMINATOR',
    ],
    [
      'unsupported format version',
      (dir: string) => {
        const fixture = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>
        fixture.formatVersion = 2
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(fixture))
      },
      'E_FORMAT_VERSION',
    ],
    [
      'unknown extra file',
      (dir: string) => writeFileSync(join(dir, 'notes.txt'), 'hello'),
      'E_UNKNOWN_FILE',
    ],
    [
      'unknown entity file',
      (dir: string) => writeFileSync(join(dir, 'secrets.jsonl'), ''),
      'E_UNKNOWN_ENTITY',
    ],
    [
      'path traversal in a manifest file name',
      (dir: string) => {
        const fixture = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
          entities: Array<{ entity: string; file: string }>
        }
        const target = fixture.entities.find((entity) => entity.entity === 'profiles')
        if (target) target.file = '../profiles.jsonl'
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(fixture))
      },
      'E_ENTITY_FILE_NAME',
    ],
  ])('rejects %s', async (_name, mutate, code) => {
    const directory = tempDir('bundle-bad')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS })
    mutate(directory)
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const errors = (result.json?.errors as Array<{ code: string }>) ?? []
    expect(errors.map((issue) => issue.code)).toContain(code)
  })

  it('rejects truncated JSONL that lost its final newline', async () => {
    const directory = tempDir('bundle-truncated')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS })
    const path = join(directory, 'profiles.jsonl')
    const contents = readFileSync(path, 'utf8')
    writeFileSync(path, contents.slice(0, contents.length - 1))
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_TRUNCATED')
  })

  it('rejects duplicate primary keys', async () => {
    const directory = tempDir('bundle-dupes')
    const duplicate = profileRow()
    writeBundleFixture(directory, { rows: { profiles: [duplicate, profileRow()] } })
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_DUPLICATE_ID')
  })

  it('rejects rows with unknown columns even when digests match', async () => {
    const directory = tempDir('bundle-unknown-column')
    const smuggled = canonicalStringify({ ...profileRow(), password_hash: 'secret-hash' })
    writeBundleFixture(directory, { rawLines: { profiles: [smuggled] } })
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_COLUMN_UNKNOWN')
  })

  it('rejects content changed after the manifest was written', async () => {
    const directory = tempDir('bundle-tampered')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS })
    const path = join(directory, 'projects.jsonl')
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n`)
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_HASH_MISMATCH')
  })

  it('rejects entity order that violates dependencies', async () => {
    const directory = tempDir('bundle-order')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS })
    const manifestPath = join(directory, 'manifest.json')
    const fixture = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      entities: Array<{ entity: string }>
    }
    fixture.entities = [
      ...fixture.entities.filter((entity) => entity.entity === 'timesheets'),
      ...fixture.entities.filter((entity) => entity.entity !== 'timesheets'),
    ]
    writeFileSync(manifestPath, JSON.stringify(fixture))
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_ENTITY_ORDER')
  })

  it('rejects a missing provenance file', async () => {
    const directory = tempDir('bundle-no-provenance')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS, omitProvenance: true })
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_PROVENANCE_MISSING')
  })

  it('rejects a symlink inside the bundle', async () => {
    const directory = tempDir('bundle-symlink')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS })
    const outside = join(tempDir('outside'), 'profiles.jsonl')
    writeFileSync(outside, '')
    try {
      symlinkSync(outside, join(directory, 'profiles_link.jsonl'), 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new Error(`symlink creation unavailable in this environment (${String(code)})`)
    }
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_SYMLINK')
  })

  it('refuses a bundle path that is itself a symlink', async () => {
    const real = tempDir('bundle-real')
    writeBundleFixture(real, { rows: VALID_BUNDLE_ROWS })
    const link = join(tmpRoot, `bundle-link-${Math.random().toString(36).slice(2, 8)}`)
    try {
      symlinkSync(real, link, 'dir')
    } catch (error) {
      throw new Error(`symlink creation unavailable in this environment (${String((error as NodeJS.ErrnoException).code)})`)
    }
    const result = await run(['validate', '--bundle', link, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_SYMLINK')
  })
})

describe('connection resolution', () => {
  it('refuses to read connection material from application env vars', () => {
    expect(() =>
      resolveDatabaseTarget({
        provider: 'native',
        role: 'source',
        envName: 'DATABASE_URL',
        env: { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' },
      })
    ).toThrow(/not allowed/)
  })

  it('requires the named env var to exist', () => {
    expect(() =>
      resolveDatabaseTarget({ provider: 'native', role: 'source', envName: 'MIGRATION_SOURCE_DB', env: {} })
    ).toThrow(/not set/)
  })

  it('rejects non-postgres values and unknown providers', () => {
    expect(() =>
      resolveDatabaseTarget({
        provider: 'native',
        role: 'source',
        envName: 'MIGRATION_SOURCE_DB',
        env: { MIGRATION_SOURCE_DB: 'https://example.com' },
      })
    ).toThrow(MigrationConfigError)
    expect(() =>
      resolveDatabaseTarget({
        provider: 'mysql',
        role: 'source',
        envName: 'MIGRATION_SOURCE_DB',
        env: { MIGRATION_SOURCE_DB: 'postgresql://u:p@localhost:5432/db' },
      })
    ).toThrow(/Unknown provider/)
  })

  it('binds Supabase Auth credentials to the same project as the database', () => {
    expect(() =>
      assertAuthDatabaseBinding(
        { projectRef: 'abcdefghijklmnop', loopback: false },
        { projectRef: 'zyxwvutsrqponmlk', loopback: false }
      )
    ).toThrow(/belongs to project/)

    expect(() =>
      assertAuthDatabaseBinding({ projectRef: 'abcdefghijklmnop', loopback: false }, { projectRef: null, loopback: true })
    ).toThrow(/does not identify the same project/)

    expect(() =>
      assertAuthDatabaseBinding({ projectRef: null, loopback: false }, { projectRef: null, loopback: false })
    ).toThrow(/refusing to bind/)

    expect(() => assertAuthDatabaseBinding({ projectRef: null, loopback: true }, { projectRef: null, loopback: true })).not.toThrow()
    expect(() =>
      assertAuthDatabaseBinding(
        { projectRef: 'abcdefghijklmnop', loopback: false },
        { projectRef: 'abcdefghijklmnop', loopback: false }
      )
    ).not.toThrow()
  })

  it('extracts project refs from direct and pooler Supabase endpoints', () => {
    expect(parsePostgresUrl('postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres').projectRef).toBe(
      'abcdefghijklmnop'
    )
    expect(
      parsePostgresUrl('postgresql://postgres.abcdefghijklmnop:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres')
        .projectRef
    ).toBe('abcdefghijklmnop')
    expect(parsePostgresUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres').projectRef).toBeNull()
    expect(parsePostgresUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres').loopback).toBe(true)
  })
})

describe('inspect command', () => {
  it('inspects a native endpoint read-only and reports counts', async () => {
    const session = fakeSession({ counts: { profiles: 3, timesheets: 12 } })
    const result = await run(
      ['inspect', '--source', 'native', '--source-env', 'MIGRATION_SOURCE_DB', '--json'],
      {
        env: { MIGRATION_SOURCE_DB: 'postgresql://user:secret@127.0.0.1:5432/native_db' },
        openSession: () => session,
      }
    )
    expect(result.code).toBe(EXIT_CODES.OK)
    expect(result.json?.role).toBe('source')
    expect(result.json?.namespace).toBeTruthy()
    expect((result.json?.counts as Record<string, number>).timesheets).toBe(12)
    expect(session.calls).toContain('assertReadOnly')
    expect(session.closed).toBe(true)
    // The connection string and password never appear in output or stdout.
    const stdout = result.out.join('\n')
    expect(stdout).not.toContain('secret')
    expect(stdout).not.toContain('postgresql://')
  })

  it('fails closed when the Auth endpoint names a different project', async () => {
    const result = await run(
      [
        'inspect',
        '--target',
        'supabase',
        '--target-env',
        'MIGRATION_TARGET_DB',
        '--auth-url-env',
        'MIGRATION_AUTH_URL',
        '--auth-service-key-env',
        'MIGRATION_SERVICE_KEY',
      ],
      {
        env: {
          MIGRATION_TARGET_DB:
            'postgresql://postgres.abcdefghijklmnop:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
          MIGRATION_AUTH_URL: 'https://zyxwvutsrqponmlk.supabase.co',
          MIGRATION_SERVICE_KEY: 'service-key-value',
        },
        openSession: () =>
          fakeSession({ provider: 'supabase', catalog: catalogFor({ hasAuthSchema: true }) }),
        openAuthAdmin: () => fakeAuthAdmin([]),
      }
    )
    expect(result.code).toBe(EXIT_CODES.ENVIRONMENT)
    expect(result.err.join('\n')).toContain('E_AUTH_DB_MISMATCH')
  })

  it('verifies Auth/database consistency on a local Supabase stack', async () => {
    const userId = '55555555-5555-4555-8555-555555555555'
    const session = fakeSession({
      provider: 'supabase',
      catalog: catalogFor({ hasAuthSchema: true, hasSupabaseMigrationLedger: true }),
      authUsers: [{ id: userId, email: 'admin@example.com' }],
    })
    const auth = fakeAuthAdmin([{ id: userId, email: 'admin@example.com' }])
    const result = await run(
      [
        'inspect',
        '--target',
        'supabase',
        '--target-env',
        'MIGRATION_TARGET_DB',
        '--auth-url-env',
        'MIGRATION_AUTH_URL',
        '--auth-service-key-env',
        'MIGRATION_SERVICE_KEY',
        '--json',
      ],
      {
        env: {
          MIGRATION_TARGET_DB: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
          MIGRATION_AUTH_URL: 'http://127.0.0.1:54321',
          MIGRATION_SERVICE_KEY: 'service-key-value',
        },
        openSession: () => session,
        openAuthAdmin: () => auth,
      }
    )
    expect(result.code).toBe(EXIT_CODES.OK)
    expect((result.json?.auth as Record<string, unknown>).verified).toBe(true)
    expect(auth.calls).toEqual(['listUsers'])
    expect(result.out.join('\n')).not.toContain('service-key-value')
  })

  it('reports provider mismatch when native points at a Supabase project', async () => {
    const result = await run(
      ['inspect', '--source', 'native', '--source-env', 'MIGRATION_SOURCE_DB'],
      {
        env: { MIGRATION_SOURCE_DB: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' },
        openSession: () => fakeSession({ catalog: catalogFor({ hasAuthSchema: true }) }),
      }
    )
    expect(result.code).toBe(EXIT_CODES.ENVIRONMENT)
    expect(result.err.join('\n')).toContain('E_PROVIDER_MISMATCH')
  })

  it('requires exactly one of --source/--target', async () => {
    const result = await run(['inspect', '--source', 'native', '--source-env', 'MIGRATION_SOURCE_DB', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB'])
    expect(result.code).toBe(EXIT_CODES.USAGE)
  })
})

describe('plan and resolve commands', () => {
  const targetEnv = { MIGRATION_TARGET_DB: 'postgresql://user:pw@127.0.0.1:5433/target_db' }

  it('builds a read-only preview plan and a decisions template without writing to the database', async () => {
    const bundle = writeBundleFixture(tempDir('plan-ok'), { rows: VALID_BUNDLE_ROWS })
    const out = join(tempDir('plan-out'), 'plan.json')
    const session = fakeSession({ counts: { profiles: 0 } })
    const result = await run(
      [
        'plan',
        '--bundle',
        bundle.directory,
        '--target',
        'native',
        '--target-env',
        'MIGRATION_TARGET_DB',
        '--target-app-version',
        '1.0.3',
        '--out',
        out,
        '--json',
      ],
      { env: targetEnv, openSession: () => session }
    )
    expect(result.code).toBe(EXIT_CODES.OK)
    const plan = JSON.parse(readFileSync(out, 'utf8')) as {
      planDigest: string
      counts: Record<string, { create: number }>
      entries: Array<{ entity: string; action: string }>
      target: { applicationVersion: string }
      snapshot: { sourceRows: Record<string, unknown[]> }
    }
    expect(plan.planDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(plan.counts.profiles.create).toBe(1)
    expect(plan.target.applicationVersion).toBe('1.0.3')
    expect(plan.snapshot.sourceRows.profiles).toHaveLength(1)
    const template = JSON.parse(readFileSync(`${out}.decisions.json`, 'utf8')) as { planDigest: string; decisions: unknown[] }
    expect(template.planDigest).toBe(plan.planDigest)
    expect(template.decisions).toEqual([])
    // Read-only session only: no INSERT/UPDATE ever reaches the fake session.
    expect(session.calls.every((call) => call.startsWith('query:select') || !call.startsWith('query:'))).toBe(true)
    expect(session.closed).toBe(true)
  })

  it('resolves a plan into an expected merged state without touching a database', async () => {
    const bundle = writeBundleFixture(tempDir('resolve-ok'), { rows: VALID_BUNDLE_ROWS })
    const outDir = tempDir('resolve-out')
    const planPath = join(outDir, 'plan.json')
    const resolvedPath = join(outDir, 'resolved.json')
    const planRun = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', planPath, '--json'],
      { env: targetEnv, openSession: () => fakeSession() }
    )
    expect(planRun.code).toBe(EXIT_CODES.OK)

    const decisionsPath = join(outDir, 'decisions.json')
    const decisions = JSON.parse(readFileSync(`${planPath}.decisions.json`, 'utf8')) as unknown
    writeFileSync(decisionsPath, JSON.stringify(decisions))

    const resolvedRun = await run(
      ['resolve', '--plan', planPath, '--decisions', decisionsPath, '--out', resolvedPath, '--json'],
      {
        openSession: () => {
          throw new Error('resolve must not open a database session')
        },
      }
    )
    expect(resolvedRun.code).toBe(EXIT_CODES.OK)
    const resolved = JSON.parse(readFileSync(resolvedPath, 'utf8')) as {
      expectedResultDigest: string
      resolutionDigest: string
      expectedResult: Record<string, unknown[]>
      entries: Array<{ status: string }>
    }
    expect(resolved.expectedResultDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(resolved.resolutionDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(resolved.expectedResult.profiles).toHaveLength(1)
    expect(resolved.entries.every((entry) => entry.status === 'resolved')).toBe(true)
  })

  it('refuses to resolve a plan whose conflicts are still marked PENDING-REVIEW', async () => {
    const rows = { profiles: [profileRow()] }
    const bundle = writeBundleFixture(tempDir('resolve-conflict'), { rows })
    const outDir = tempDir('resolve-conflict-out')
    const planPath = join(outDir, 'plan.json')
    await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', planPath, '--json'],
      { env: targetEnv, openSession: () => fakeSession({ targetRows: { profiles: [profileRow()] } }) }
    )
    const resolvedRun = await run(
      [
        'resolve',
        '--plan',
        planPath,
        '--decisions',
        `${planPath}.decisions.json`,
        '--out',
        join(outDir, 'resolved.json'),
        '--json',
      ],
      {}
    )
    expect(resolvedRun.code).toBe(EXIT_CODES.VALIDATION)
    expect(resolvedRun.err.join('\n')).toContain('E_RESOLUTION_INVALID')
    expect(JSON.stringify(resolvedRun.json)).toContain('E_DECISION_PENDING_REVIEW')
  })

  it('rejects a decisions file that targets a different plan digest', async () => {
    const bundle = writeBundleFixture(tempDir('resolve-digest'), { rows: VALID_BUNDLE_ROWS })
    const outDir = tempDir('resolve-digest-out')
    const planPath = join(outDir, 'plan.json')
    await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', planPath, '--json'],
      { env: targetEnv, openSession: () => fakeSession() }
    )
    const decisionsPath = join(outDir, 'decisions.json')
    writeFileSync(
      decisionsPath,
      JSON.stringify({
        format: 'vsis-data-migration-resolutions',
        formatVersion: 1,
        planDigest: 'f'.repeat(64),
        operator: { name: 'Operator', at: '2026-09-19T10:00:00.000000Z' },
        decisions: [],
      })
    )
    const result = await run(
      ['resolve', '--plan', planPath, '--decisions', decisionsPath, '--out', join(outDir, 'resolved.json'), '--json'],
      {}
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_PLAN_DIGEST_MISMATCH')
  })

  it('blocks a Supabase plan without Auth binding inputs', async () => {
    const bundle = writeBundleFixture(tempDir('plan-supabase'), { rows: VALID_BUNDLE_ROWS })
    const result = await run(
      [
        'plan',
        '--bundle',
        bundle.directory,
        '--target',
        'supabase',
        '--target-env',
        'MIGRATION_TARGET_DB',
        '--out',
        join(tempDir('plan-supabase-out'), 'plan.json'),
      ],
      {
        env: { MIGRATION_TARGET_DB: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' },
        openSession: () =>
          fakeSession({ provider: 'supabase', catalog: catalogFor({ hasAuthSchema: true, hasSupabaseMigrationLedger: true }) }),
      }
    )
    expect(result.code).toBe(EXIT_CODES.BLOCKED)
    expect(result.err.join('\n')).toContain('E_AUTH_REQUIRED')
  })
})

describe('preflight command', () => {
  const targetEnv = { MIGRATION_TARGET_DB: 'postgresql://user:pw@127.0.0.1:5433/target_db' }
  const sourceEnv = { MIGRATION_SOURCE_DB: 'postgresql://user:pw@127.0.0.1:5432/source_db' }

  it('passes for distinct compatible endpoints', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-ok'), { rows: VALID_BUNDLE_ROWS })
    const target = fakeSession({ namespace: 'native:target', runtimeFingerprint: 'runtime-target' })
    const source = fakeSession({ namespace: 'native:source', runtimeFingerprint: 'runtime-source' })
    const result = await run(
      [
        'preflight',
        '--bundle',
        bundle.directory,
        '--target',
        'native',
        '--target-env',
        'MIGRATION_TARGET_DB',
        '--source',
        'native',
        '--source-env',
        'MIGRATION_SOURCE_DB',
        '--json',
      ],
      { env: { ...targetEnv, ...sourceEnv }, openSession: (resolved) => (resolved.role === 'destination' ? target : source) }
    )
    expect(result.code).toBe(EXIT_CODES.OK)
    expect(result.json?.ok).toBe(true)
    const checks = result.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find((check) => check.id === 'distinct-instances')?.status).toBe('pass')
    expect(target.closed).toBe(true)
    expect(source.closed).toBe(true)
  })

  it('fails when source and target are the same instance behind different endpoints', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-same'), { rows: VALID_BUNDLE_ROWS })
    const shared = { namespace: 'native:same', runtimeFingerprint: 'runtime-same' }
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--source', 'native', '--source-env', 'MIGRATION_SOURCE_DB', '--json'],
      { env: { ...targetEnv, ...sourceEnv }, openSession: () => fakeSession(shared) }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find((check) => check.id === 'distinct-instances')?.status).toBe('fail')
  })

  it('fails when the target schema is missing a table', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-schema'), { rows: VALID_BUNDLE_ROWS })
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--json'],
      {
        env: targetEnv,
        openSession: () =>
          fakeSession({ missingTables: ['timesheets'], catalog: catalogFor({ omitTable: 'timesheets' }) }),
      }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string; detail: string }>
    expect(checks.find((check) => check.id === 'target-schema')?.status).toBe('fail')
  })

  it('is blocked for a Supabase target without Auth inputs', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-supabase'), { rows: VALID_BUNDLE_ROWS })
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'supabase', '--target-env', 'MIGRATION_TARGET_DB', '--json'],
      {
        env: {
          MIGRATION_TARGET_DB: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
          MIGRATION_TARGET_AUTH_URL: 'http://127.0.0.1:54321',
        },
        openSession: () =>
          fakeSession({ provider: 'supabase', catalog: catalogFor({ hasAuthSchema: true, hasSupabaseMigrationLedger: true }) }),
      }
    )
    expect(result.code).toBe(EXIT_CODES.BLOCKED)
    const checks = result.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find((check) => check.id === 'auth-binding')?.status).toBe('blocked')
  })

  it('does not run when the bundle is invalid', async () => {
    const directory = tempDir('preflight-bad-bundle')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS, mutateManifest: (manifest) => ({ ...manifest, formatVersion: 99 as unknown as 1 }) })
    const result = await run(
      ['preflight', '--bundle', directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB'],
      {
        env: targetEnv,
        openSession: () => {
          throw new Error('preflight must validate the bundle before connecting')
        },
      }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
  })
})

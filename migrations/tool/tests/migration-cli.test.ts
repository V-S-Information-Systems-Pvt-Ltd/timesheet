// tests/migration-cli.test.ts
// C01 CLI safety boundary: offline validation, explicit connection inputs,
// read-only sessions, provider/Auth binding, exclusive artifacts and exit codes.
//
// Database behavior is exercised through injected fake sessions that mirror the
// real session's guarantees: only SELECT statements are accepted, and the
// write probe must be rejected. Real live-database evidence is a C02 gate.

import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { EXIT_CODES, parseArgs, runCli, CliUsageError, type CliDependencies } from '@vsis/migration-tool/cli'
import {
  MigrationConfigError,
  assertAuthDatabaseBinding,
  parsePostgresUrl,
  resolveDatabaseTarget,
} from '@vsis/migration-tool/connections'
import { MigrationRunError, RUN_ROOT, redactResult, redactString } from '@vsis/migration-tool/journal'
import { computeDatabaseNamespace, type DatabaseSession } from '@vsis/migration-tool/providers/session'
import type { AuthAdminPort } from '@vsis/migration-tool/providers/supabase'
import { ENTITY_ORDER, ENTITY_SPECS, canonicalStringify, entitySpec, type MigrationEntity } from '@vsis/migration-tool/format'
import { buildPreview } from '@vsis/migration-tool/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan } from '@vsis/migration-tool/resolutions'
import {
  KIND_ACCEPTED_UDTS,
  REQUIRED_MIGRATIONS,
  checkMigrationLedger,
  computeProviderSchemaFingerprint,
  computeSchemaFingerprint,
  isSupportedSchemaFingerprint,
  PROVIDER_SCHEMA_FINGERPRINTS,
  type CatalogColumn,
  type CatalogInspection,
} from '@vsis/migration-tool/schema'
import {
  makeManifest,
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
  const provider = over.hasAuthSchema || over.hasSupabaseMigrationLedger ? 'supabase' : 'native'
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
        udtName:
          provider === 'native' &&
          (entity === 'titles' || entity === 'whitelisted_domains') &&
          spec.name === 'id'
            ? 'text'
            : KIND_TO_UDT[spec.kind],
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

function legacySupabaseCatalog(retired = false): CatalogInspection {
  const catalog = catalogFor({ hasAuthSchema: true, hasSupabaseMigrationLedger: true })
  const nullable = new Set(['profiles.is_active', 'projects.created_at', 'timesheets.work_done', 'timesheets.created_at'])
  for (const column of catalog.columns) if (nullable.has(`${column.table}.${column.column}`)) column.nullable = true
  if (!retired) catalog.columns.push({ table: 'profiles', column: 'full_name', udtName: 'text', nullable: true })
  return catalog
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
    missingReceiptTables?: boolean
  } = {}
): FakeSession {
  const calls: string[] = []
  const state = { closed: false }
  const catalog =
    over.catalog ??
    catalogFor(
      over.provider === 'supabase'
        ? { hasAuthSchema: true, hasSupabaseMigrationLedger: true }
        : undefined
    )
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
      if (over.missingReceiptTables && text.includes('migration_record_map')) {
        const error = new Error('relation "public.migration_record_map" does not exist') as Error & { code?: string }
        error.code = '42P01'
        throw error
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
      return (
        over.migrations ??
        (over.provider === 'supabase'
          ? [
              '20260810160000', '20260920000000_idempotency_effects.sql',
              '20260930000000_migration_receipts.sql', '20261001000000_migration_write_gate.sql',
              '20261002000000_migration_record_dispositions.sql', '20261003000000_migration_retry_history.sql',
              '20261004000000_migration_write_gate_generation.sql',
              '20261005000000_migration_fresh_keys.sql', '20261007000000_timesheet_classification.sql', '20261008000000_classification_reporting_restore.sql',
            ]
          : [
              '0001_initial_schema.sql', '0031_idempotency_effects.sql', '0032_migration_receipts.sql',
              '0033_migration_write_gate.sql', '0034_migration_record_dispositions.sql',
              '0035_migration_retry_history.sql', '0036_migration_write_gate_generation.sql',
              '0037_migration_fresh_keys.sql', '0039_timesheet_classification.sql', '0040_classification_reporting.sql',
            ])
      )
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
): AuthAdminPort & { calls: string[]; directory: Array<{ id: string; email: string | null }> } {
  const calls: string[] = []
  const directory = users.map((user) => ({ id: user.id, email: user.email }))
  return {
    calls,
    directory,
    async listUsers() {
      calls.push('listUsers')
      return users.map((user) => ({
        id: user.id,
        email: user.email,
        emailConfirmedAt: user.emailConfirmedAt ?? null,
      }))
    },
    async findUserByEmail(email: string) {
      calls.push('findUserByEmail')
      const match = directory.find((user) => (user.email ?? '').toLowerCase() === email.trim().toLowerCase())
      return match ? { ...match, emailConfirmedAt: null } : null
    },
    async createUser({ id, email }) {
      calls.push('createUser')
      directory.push({ id, email })
      return { id, email, emailConfirmedAt: null }
    },
    async deleteUser(id: string) {
      calls.push('deleteUser')
      const index = directory.findIndex((user) => user.id === id)
      if (index >= 0) directory.splice(index, 1)
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

  it('keeps run directories and sensitive journal artifacts private on POSIX', async () => {
    if (process.platform === 'win32') return
    const bundle = writeBundleFixture(tempDir('bundle-private-artifacts'), { rows: VALID_BUNDLE_ROWS })
    const runRoot = join(tempDir('private-run-root'), RUN_ROOT)
    const result = await run(['validate', '--bundle', bundle.directory], { runRoot })
    expect(result.code).toBe(EXIT_CODES.OK)
    const directory = join(runRoot, readdirSync(runRoot)[0])
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    expect(statSync(join(directory, 'journal.jsonl')).mode & 0o777).toBe(0o600)
    expect(statSync(join(directory, 'result.json')).mode & 0o777).toBe(0o600)
  })

  it('rejects an output path that resolves inside the bundle through .. segments', async () => {
    const bundle = writeBundleFixture(tempDir('bundle-output-dotdot'), { rows: VALID_BUNDLE_ROWS })
    const out = `${bundle.directory}${sep}..${sep}${basename(bundle.directory)}${sep}plan.json`
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out],
      {
        env: { MIGRATION_TARGET_DB: 'postgresql://u:p@127.0.0.1:5433/target_db' },
        openSession: () => {
          throw new Error('path guard must run before opening a database session')
        },
      }
    )
    expect(result.code).toBe(EXIT_CODES.USAGE)
    expect(result.err.join('\n')).toContain('--out must not point inside')
  })

  it('rejects a run directory that resolves inside the bundle', async () => {
    const bundle = writeBundleFixture(tempDir('bundle-rundir-dotdot'), { rows: VALID_BUNDLE_ROWS })
    const runDirectory = `${bundle.directory}${sep}..${sep}${basename(bundle.directory)}${sep}run`
    const result = await run(['validate', '--bundle', bundle.directory, '--run-dir', runDirectory])
    expect(result.code).toBe(EXIT_CODES.USAGE)
    expect(result.err.join('\n')).toContain('--run-dir/--runRoot must not point inside')
  })

  it('rejects an output path whose parent symlink resolves into the bundle', async () => {
    const bundle = writeBundleFixture(tempDir('bundle-output-symlink'), { rows: VALID_BUNDLE_ROWS })
    const link = join(tempDir('bundle-output-symlink-parent'), 'bundle-link')
    try {
      symlinkSync(bundle.directory, link, 'dir')
    } catch (error) {
      throw new Error(`symlink creation unavailable in this environment (${String((error as NodeJS.ErrnoException).code)})`)
    }
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', join(link, 'plan.json')],
      { openSession: () => { throw new Error('path guard must run before opening a database session') } }
    )
    expect(result.code).toBe(EXIT_CODES.USAGE)
    expect(result.err.join('\n')).toContain('--out must not point inside')
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
      'null manifest JSON',
      (dir: string) => writeFileSync(join(dir, 'manifest.json'), 'null'),
      'E_MANIFEST_SCHEMA',
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
        fixture.formatVersion = 99
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

  it('rejects an entity row exceeding the byte limit before buffering unbounded memory', async () => {
    const directory = tempDir('bundle-huge-line')
    writeBundleFixture(directory, { rows: VALID_BUNDLE_ROWS })
    const path = join(directory, 'profiles.jsonl')
    // A line exceeding 4MB (BUNDLE_LIMITS.rowBytes) without a newline
    const hugeBuf = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x20)
    writeFileSync(path, hugeBuf)
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_ROW_TOO_LARGE')
  })

  it('validates a declared source identity inventory', async () => {
    const directory = tempDir('bundle-identities')
    writeBundleFixture(directory, {
      rows: VALID_BUNDLE_ROWS,
      identities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          emailConfirmed: true,
          hasCredential: null,
          providerIdentities: ['email'],
          mfaFactors: 0,
        },
      ],
    })
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.OK)
    expect(result.json?.ok).toBe(true)
  })

  it('rejects an identity inventory the manifest does not declare', async () => {
    const directory = tempDir('bundle-identities-undeclared')
    writeBundleFixture(directory, {
      rows: VALID_BUNDLE_ROWS,
      identities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          emailConfirmed: true,
          hasCredential: null,
          providerIdentities: ['email'],
          mfaFactors: 0,
        },
      ],
    })
    const manifestPath = join(directory, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    delete manifest.identities
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_UNKNOWN_FILE')
  })

  it('rejects a duplicated source identity record', async () => {
    const directory = tempDir('bundle-identities-duplicate')
    const fact = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'alice@example.com',
      emailConfirmed: true,
      hasCredential: null,
      providerIdentities: ['email'],
      mfaFactors: 0,
    }
    writeBundleFixture(directory, {
      rows: VALID_BUNDLE_ROWS,
      identities: [fact, { ...fact, providerIdentities: ['google'] }],
    })
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_IDENTITIES_SCHEMA')
  })

  it('rejects an identity inventory that no longer matches the manifest digest', async () => {
    const directory = tempDir('bundle-identities-tampered')
    writeBundleFixture(directory, {
      rows: VALID_BUNDLE_ROWS,
      identities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          emailConfirmed: true,
          hasCredential: null,
          providerIdentities: ['email'],
          mfaFactors: 0,
        },
      ],
    })
    const path = join(directory, 'identities.json')
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      identities: Array<{ providerIdentities: string[] }>
    }
    parsed.identities[0].providerIdentities = ['google', 'email']
    writeFileSync(path, JSON.stringify(parsed))
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_HASH_MISMATCH')
  })

  it('rejects a declared identity inventory that is missing from the bundle', async () => {
    const directory = tempDir('bundle-identities-missing')
    writeBundleFixture(directory, {
      rows: VALID_BUNDLE_ROWS,
      identities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          emailConfirmed: true,
          hasCredential: null,
          providerIdentities: ['email'],
          mfaFactors: 0,
        },
      ],
    })
    rmSync(join(directory, 'identities.json'))
    const result = await run(['validate', '--bundle', directory, '--json'])
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(JSON.stringify(result.json)).toContain('E_IDENTITIES_MISSING')
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

describe('provider schema fingerprints', () => {
  it.each([false, true])('accepts the known legacy Supabase source only (retired=%s)', (retired) => {
    const fingerprint = computeSchemaFingerprint(legacySupabaseCatalog(retired), 'supabase')
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(isSupportedSchemaFingerprint(fingerprint, 'supabase', 'source')).toBe(true)
    expect(isSupportedSchemaFingerprint(fingerprint, 'supabase')).toBe(false)
    expect(isSupportedSchemaFingerprint(fingerprint, 'native', 'source')).toBe(false)
    expect(isSupportedSchemaFingerprint(fingerprint)).toBe(false)
  })

  it.each(['extra', 'missing', 'type', 'nullable'])('rejects additional legacy source drift (%s)', (drift) => {
    const catalog = legacySupabaseCatalog()
    if (drift === 'extra') catalog.columns.push({ table: 'profiles', column: 'unreviewed', udtName: 'text', nullable: true })
    if (drift === 'missing') catalog.columns = catalog.columns.filter(column => !(column.table === 'profiles' && column.column === 'name'))
    if (drift === 'type') catalog.columns.find(column => column.column === 'full_name')!.udtName = 'varchar'
    if (drift === 'nullable') catalog.columns.find(column => column.table === 'profiles' && column.column === 'email')!.nullable = true
    expect(isSupportedSchemaFingerprint(computeSchemaFingerprint(catalog, 'supabase'), 'supabase', 'source')).toBe(false)
  })

  it('matches the provider catalogs, including native text UUID primary keys', () => {
    const native = catalogFor()
    const supabase = catalogFor({ hasAuthSchema: true, hasSupabaseMigrationLedger: true })
    expect(computeProviderSchemaFingerprint('native')).toBe(PROVIDER_SCHEMA_FINGERPRINTS.native)
    expect(computeProviderSchemaFingerprint('supabase')).toBe(PROVIDER_SCHEMA_FINGERPRINTS.supabase)
    expect(computeSchemaFingerprint(native, 'native')).toBe(PROVIDER_SCHEMA_FINGERPRINTS.native)
    expect(computeSchemaFingerprint(supabase, 'supabase')).toBe(PROVIDER_SCHEMA_FINGERPRINTS.supabase)
    expect(PROVIDER_SCHEMA_FINGERPRINTS.native).not.toBe(PROVIDER_SCHEMA_FINGERPRINTS.supabase)
    expect(isSupportedSchemaFingerprint(PROVIDER_SCHEMA_FINGERPRINTS.native, 'native')).toBe(true)
    expect(isSupportedSchemaFingerprint(PROVIDER_SCHEMA_FINGERPRINTS.native, 'supabase')).toBe(false)
  })

  it('ignores provider-owned profile columns but rejects an unexplained entity column', () => {
    const native = catalogFor()
    native.columns.push(
      { table: 'profiles', column: 'role', udtName: 'text', nullable: false },
      { table: 'profiles', column: 'password_hash', udtName: 'text', nullable: true },
      { table: 'profiles', column: 'session_version', udtName: 'int4', nullable: false }
    )
    expect(computeSchemaFingerprint(native, 'native')).toBe(PROVIDER_SCHEMA_FINGERPRINTS.native)
    native.columns.push({ table: 'profiles', column: 'unexpected', udtName: 'text', nullable: true })
    expect(isSupportedSchemaFingerprint(computeSchemaFingerprint(native, 'native'), 'native')).toBe(false)
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

  it('refuses to plan a bundle whose source namespace is the target namespace', async () => {
    const bundle = writeBundleFixture(tempDir('plan-self-import'), {
      rows: VALID_BUNDLE_ROWS,
      mutateManifest: (manifest) => ({
        ...manifest,
        source: { ...manifest.source, namespace: 'native:11111111111111111111111111111111' },
      }),
    })
    const out = join(tempDir('plan-self-import-out'), 'plan.json')
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out],
      {
        env: targetEnv,
        openSession: () => fakeSession({ namespace: 'native:11111111111111111111111111111111' }),
      }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(result.err.join('\n')).toContain('E_SOURCE_TARGET_SAME_INSTANCE')
    expect(() => readFileSync(out, 'utf8')).toThrow()
  })

  it('refuses a plan whose bundle source instance facts match the target', async () => {
    // Different namespaces (the privileged system identifier was readable on
    // one connection only) but the same role-independent server facts.
    const bundle = writeBundleFixture(tempDir('plan-self-import-fingerprint'), {
      rows: VALID_BUNDLE_ROWS,
      mutateManifest: (manifest) => ({
        ...manifest,
        source: { ...manifest.source, runtimeFingerprint: 'same-instance-facts' },
      }),
    })
    const out = join(tempDir('plan-self-import-fingerprint-out'), 'plan.json')
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out],
      {
        env: targetEnv,
        openSession: () => fakeSession({ runtimeFingerprint: 'same-instance-facts' }),
      }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(result.err.join('\n')).toContain('E_SOURCE_TARGET_SAME_INSTANCE')
    expect(() => readFileSync(out, 'utf8')).toThrow()
  })

  it('rechecks the manifest digest before loading rows for a plan', async () => {
    const bundle = writeBundleFixture(tempDir('plan-manifest-reread'), { rows: VALID_BUNDLE_ROWS })
    const out = join(tempDir('plan-manifest-reread-out'), 'plan.json')
    const manifestPath = join(bundle.directory, 'manifest.json')
    const original = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out],
      {
        env: targetEnv,
        openSession: () => {
          writeFileSync(manifestPath, `${canonicalStringify({ ...original, runId: 'tampered-after-validation' })}\n`)
          return fakeSession()
        },
      }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(result.err.join('\n')).toContain('E_BUNDLE_CHANGED')
  })

  it('rehashes and recounts entity rows after validation before planning', async () => {
    const bundle = writeBundleFixture(tempDir('plan-row-reread'), { rows: VALID_BUNDLE_ROWS })
    const out = join(tempDir('plan-row-reread-out'), 'plan.json')
    const projectsPath = join(bundle.directory, 'projects.jsonl')
    const original = readFileSync(projectsPath, 'utf8')
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out],
      {
        env: targetEnv,
        openSession: () => {
          writeFileSync(projectsPath, original.replace('Support', 'Support2'))
          return fakeSession()
        },
      }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(result.err.join('\n')).toMatch(/E_(SIZE|HASH)_MISMATCH/)
  })

  it('fails closed when the required migration receipt tables are absent', async () => {
    const bundle = writeBundleFixture(tempDir('plan-missing-receipts'), { rows: VALID_BUNDLE_ROWS })
    const out = join(tempDir('plan-missing-receipts-out'), 'plan.json')
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out],
      { env: targetEnv, openSession: () => fakeSession({ missingReceiptTables: true }) }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(result.err.join('\n')).toContain('E_MIGRATION_RECEIPTS')
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

  it('canonicalizes PostgreSQL jsonb text while planning against a populated destination', async () => {
    const bundle = writeBundleFixture(tempDir('plan-jsonb'), { rows: VALID_BUNDLE_ROWS })
    const out = join(tempDir('plan-jsonb-out'), 'plan.json')
    // PostgreSQL prints jsonb as `{"b": 2, "a": 1}`; the reader must produce the
    // canonical form instead of rejecting it.
    const session = fakeSession({
      targetRows: {
        profiles: [profileRow({ id: '40000000-0000-4000-8000-000000000001', dashboard_layout: '{"b": 2, "a": [1, 2, 3]}' })],
      },
    })
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out, '--json'],
      { env: targetEnv, openSession: () => session, openAuthAdmin: () => fakeAuthAdmin([]) }
    )
    expect(result.code).toBe(EXIT_CODES.OK)
    const plan = JSON.parse(readFileSync(out, 'utf8')) as {
      snapshot: { targetRows: { profiles: Array<{ dashboard_layout: string | null }> } }
    }
    expect(plan.snapshot.targetRows.profiles[0].dashboard_layout).toBe('{"a":[1,2,3],"b":2}')
  })

  it('carries the bundle source assurance facts into the reviewed plan', async () => {
    const bundle = writeBundleFixture(tempDir('plan-source-identities'), {
      rows: VALID_BUNDLE_ROWS,
      identities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          emailConfirmed: true,
          hasCredential: null,
          providerIdentities: ['google'],
          mfaFactors: 0,
        },
      ],
    })
    const out = join(tempDir('plan-source-identities-out'), 'plan.json')
    const result = await run(
      ['plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--out', out, '--json'],
      { env: targetEnv, openSession: () => fakeSession() }
    )
    expect(result.code).toBe(EXIT_CODES.OK)
    const plan = JSON.parse(readFileSync(out, 'utf8')) as {
      snapshot: {
        sourceIdentities: Array<{ id: string; providerIdentities: string[] | null }>
        identities: unknown[]
      }
    }
    expect(plan.snapshot.sourceIdentities).toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        providerIdentities: ['google'],
      }),
    ])
    // Destination identity facts stay separate from source assurance.
    expect(plan.snapshot.identities).toEqual([])
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

  it.each([
    { retired: false, targetVersion: '1.0.3' },
    { retired: true, targetVersion: '1.0.3' },
    { retired: false, targetVersion: '1.1.6' },
    { retired: true, targetVersion: '1.1.6' },
  ])('preflights and plans the known source against native $targetVersion (retired=$retired)', async ({ retired, targetVersion }) => {
    const catalog = legacySupabaseCatalog(retired)
    const bundle = writeBundleFixture(tempDir('preflight-legacy'), {
      rows: VALID_BUNDLE_ROWS,
      mutateManifest: manifest => ({ ...manifest, source: {
        ...manifest.source, provider: 'supabase', namespace: 'supabase:legacy-source',
        schemaFingerprint: computeSchemaFingerprint(catalog, 'supabase'),
      } }),
    })
    const source = fakeSession({ provider: 'supabase', catalog, namespace: 'supabase:legacy-source', runtimeFingerprint: 'source', migrations: [...REQUIRED_MIGRATIONS.supabase] })
    const target = fakeSession({ namespace: 'native:target', runtimeFingerprint: 'target' })
    const result = await run([
      'preflight', '--bundle', bundle.directory, '--source', 'supabase', '--source-env', 'MIGRATION_SOURCE_DB',
      '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--target-app-version', targetVersion, '--json',
    ], { env: { ...targetEnv, ...sourceEnv }, openSession: resolved => resolved.role === 'source' ? source : target })
    expect(result.code).toBe(EXIT_CODES.OK)
    const checks = result.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find(check => check.id === 'source-schema')?.status).toBe('pass')
    expect(checks.find(check => check.id === 'target-schema')?.status).toBe('pass')
    expect(checks.find(check => check.id === 'release-compatibility')?.status).toBe('pass')
    const previewPath = join(tempDir('plan-legacy-source'), 'plan.json')
    const planned = await run([
      'plan', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB',
      '--target-app-version', targetVersion, '--out', previewPath, '--json',
    ], { env: targetEnv, openSession: () => fakeSession() })
    expect(planned.code).toBe(EXIT_CODES.OK)
    const preview = JSON.parse(readFileSync(previewPath, 'utf8'))
    expect(preview.sourceInstance.applicationVersion).toBe('1.0.3')
    expect(preview.target.applicationVersion).toBe(targetVersion)
    const manifest = JSON.parse(readFileSync(join(bundle.directory, 'manifest.json'), 'utf8'))
    expect(manifest.source.applicationVersion).toBe('1.0.3')
    expect(manifest.tool.applicationVersion).toBe('1.0.3')
    expect(source.closed).toBe(true)
    expect(target.closed).toBe(true)
  })

  it.each([
    { source: 'native', sourceVersion: '1.0.3', target: 'native', targetVersion: '1.1.6', toolVersion: '1.0.3' },
    { source: 'supabase', sourceVersion: '1.0.3', target: 'supabase', targetVersion: '1.1.6', toolVersion: '1.0.3' },
    { source: 'native', sourceVersion: '1.1.6', target: 'supabase', targetVersion: '1.0.3', toolVersion: '1.1.6' },
    { source: 'supabase', sourceVersion: '1.0.3', target: 'native', targetVersion: '9.9.9', toolVersion: '1.0.3' },
    { source: 'supabase', sourceVersion: '1.0.3', target: 'native', targetVersion: '1.1.6', toolVersion: '1.1.6' },
  ] as const)('refuses preflight and plan for $source $sourceVersion to $target $targetVersion (tool declaration $toolVersion)', async ({ source, sourceVersion, target, targetVersion, toolVersion }) => {
    const bundle = writeBundleFixture(tempDir('release-pair'), {
      rows: VALID_BUNDLE_ROWS,
      mutateManifest: manifest => ({
        ...manifest,
        source: { ...manifest.source, provider: source, applicationVersion: sourceVersion, schemaFingerprint: PROVIDER_SCHEMA_FINGERPRINTS[source] },
        tool: { ...manifest.tool, applicationVersion: toolVersion },
      }),
    })
    const flags = ['--bundle', bundle.directory, '--target', target, '--target-env', 'MIGRATION_TARGET_DB', '--target-app-version', targetVersion, '--json']
    const preflight = await run(['preflight', ...flags], { env: targetEnv, openSession: () => fakeSession({ provider: target }) })
    expect(preflight.code).toBe(EXIT_CODES.VALIDATION)
    const checks = preflight.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find(check => check.id === 'release-compatibility')?.status).toBe('fail')
    const openSession = vi.fn(() => fakeSession({ provider: target }))
    const path = join(tempDir('release-pair-preview'), 'plan.json')
    const planned = await run(['plan', ...flags, '--out', path], { env: targetEnv, openSession })
    expect(planned.code).toBe(EXIT_CODES.VALIDATION)
    expect(openSession).not.toHaveBeenCalled()
    expect(() => readFileSync(path, 'utf8')).toThrow()
  })

  it.each(['schema', 'ledger'])('retains the %s refusal for the admitted 1.1.6 target', async guard => {
    const bundle = writeBundleFixture(tempDir('upgrade-guard'), {
      rows: VALID_BUNDLE_ROWS,
      mutateManifest: manifest => ({ ...manifest, source: { ...manifest.source, provider: 'supabase', schemaFingerprint: PROVIDER_SCHEMA_FINGERPRINTS.supabase } }),
    })
    const catalog = catalogFor()
    if (guard === 'schema') catalog.columns.push({ table: 'profiles', column: 'unexpected', udtName: 'text', nullable: true })
    const makeTarget = () => fakeSession({ catalog, migrations: guard === 'ledger' ? [] : [...REQUIRED_MIGRATIONS.native] })
    const flags = ['--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--target-app-version', '1.1.6', '--json']
    const preflight = await run(['preflight', ...flags], { env: targetEnv, openSession: makeTarget })
    expect(preflight.code).toBe(EXIT_CODES.VALIDATION)
    const checks = preflight.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find(check => check.id === 'release-compatibility')?.status).toBe('pass')
    const planned = await run(['plan', ...flags, '--out', join(tempDir('upgrade-guard-preview'), 'plan.json')], { env: targetEnv, openSession: makeTarget })
    expect(planned.code).toBe(EXIT_CODES.VALIDATION)
    expect(planned.err.join('\n')).toContain(guard === 'schema' ? 'E_TARGET_SCHEMA' : 'E_MIGRATION_LEDGER')
  })

  it('refuses the legacy source shape as a Supabase destination', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-legacy-target'), { rows: VALID_BUNDLE_ROWS })
    const result = await run([
      'preflight', '--bundle', bundle.directory, '--target', 'supabase', '--target-env', 'MIGRATION_TARGET_DB', '--json',
    ], { env: targetEnv, openSession: () => fakeSession({ provider: 'supabase', catalog: legacySupabaseCatalog() }) })
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find(check => check.id === 'target-schema')?.status).toBe('fail')
  })

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

  it('fails preflight when the bundle application release is unsupported or mismatched', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-release'), {
      rows: VALID_BUNDLE_ROWS,
      mutateManifest: (manifest) => ({
        ...manifest,
        tool: { ...manifest.tool, applicationVersion: '0.9.0' },
        source: { ...manifest.source, applicationVersion: '0.9.0' },
      }),
    })
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--json'],
      { env: targetEnv, openSession: () => fakeSession() }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string; detail: string }>
    const check = checks.find((c) => c.id === 'release-compatibility')
    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('0.9.0')
  })

  it('fails preflight when the target schema fingerprint is not supported', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-fingerprint'), { rows: VALID_BUNDLE_ROWS })
    const badCatalog = catalogFor()
    badCatalog.columns.push({ table: 'profiles', column: 'extra', udtName: 'text', nullable: true })
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--json'],
      { env: targetEnv, openSession: () => fakeSession({ catalog: badCatalog }) }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string; detail: string }>
    expect(checks.find((c) => c.id === 'target-schema')?.status).toBe('fail')
  })

  it('fails preflight when the target migration ledger is missing required milestones', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-ledger'), { rows: VALID_BUNDLE_ROWS })
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--json'],
      { env: targetEnv, openSession: () => fakeSession({ migrations: ['0001_initial_schema.sql'] }) }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string; detail: string }>
    const check = checks.find((c) => c.id === 'target-migrations')
    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('0031_idempotency_effects.sql')
    expect(check?.detail).toContain('0032_migration_receipts.sql')
  })

  it('requires the gate-generation migration on both providers', () => {
    expect(checkMigrationLedger('native', REQUIRED_MIGRATIONS.native.filter((name) => !name.startsWith('0036_'))))
      .toEqual({ ok: false, missing: ['0036_migration_write_gate_generation.sql'] })
    expect(checkMigrationLedger('supabase', REQUIRED_MIGRATIONS.supabase.filter((name) => name !== '20261004000000')))
      .toEqual({ ok: false, missing: ['20261004000000'] })
  })

  it('requires the fresh-key migration on both providers', () => {
    expect(checkMigrationLedger('native', REQUIRED_MIGRATIONS.native.filter((name) => !name.startsWith('0037_'))))
      .toEqual({ ok: false, missing: ['0037_migration_fresh_keys.sql'] })
    expect(checkMigrationLedger('supabase', REQUIRED_MIGRATIONS.supabase.filter((name) => name !== '20261005000000')))
      .toEqual({ ok: false, missing: ['20261005000000'] })
  })

  it('fails preflight when the receipt migration is recorded but its tables are absent', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-missing-receipts'), { rows: VALID_BUNDLE_ROWS })
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--json'],
      { env: targetEnv, openSession: () => fakeSession({ missingReceiptTables: true }) }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string }>
    expect(checks.find((check) => check.id === 'migration-receipts')?.status).toBe('fail')
  })

  it('fails preflight when a declared transformation is unsupported and does not waive schema type mismatch', async () => {
    const bundle = writeBundleFixture(tempDir('preflight-transformation'), {
      rows: VALID_BUNDLE_ROWS,
      mutateManifest: (manifest) => ({
        ...manifest,
        transformations: [{ entity: 'profiles', column: 'department', kind: 'custom', detail: 'int-to-text' }],
      }),
    })
    const typeMismatchCatalog = catalogFor()
    const depCol = typeMismatchCatalog.columns.find((c) => c.table === 'profiles' && c.column === 'department')
    if (depCol) depCol.udtName = 'int4'
    const result = await run(
      ['preflight', '--bundle', bundle.directory, '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--json'],
      { env: targetEnv, openSession: () => fakeSession({ catalog: typeMismatchCatalog }) }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    const checks = result.json?.checks as Array<{ id: string; status: string; detail: string }>
    const check = checks.find((c) => c.id === 'target-schema')
    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('E_SCHEMA_UNSUPPORTED_TRANSFORMATION')
    expect(check?.detail).toContain('E_SCHEMA_TYPE_MISMATCH')
  })
})

describe('database session instance identity fallback', () => {
  // Boot-time facts may detect aliases within one run, but cannot form a
  // durable provenance namespace because they change after a restart.
  const sameInstance = null

  function target(name: string, url: string, role: 'source' | 'destination') {
    return resolveDatabaseTarget({
      provider: 'native',
      role,
      envName: name,
      env: { [name]: url },
    })
  }

  it('fails closed when a native database has no durable system identifier', () => {
    const aliasA = target('MIGRATION_SOURCE_DB', 'postgresql://u:p@db-alias-1.corp:5432/timesheet_db', 'source')
    expect(() => computeDatabaseNamespace(aliasA, 'timesheet_db', sameInstance)).toThrow(
      /durable instance identifier/
    )
  })

  it('always uses a verified Supabase project reference regardless of probe privilege', () => {
    const direct = resolveDatabaseTarget({
      provider: 'supabase', role: 'source', envName: 'MIGRATION_SOURCE_DB',
      env: { MIGRATION_SOURCE_DB: 'postgresql://u:p@db.project-a.supabase.co:5432/timesheet_db' },
    })
    const pooler = resolveDatabaseTarget({
      provider: 'supabase', role: 'destination', envName: 'MIGRATION_TARGET_DB',
      env: { MIGRATION_TARGET_DB: 'postgresql://postgres.project-a@pooler.corp:6543/timesheet_db' },
    })
    expect(computeDatabaseNamespace(direct, 'timesheet_db', '7123456789012345678')).toBe(
      computeDatabaseNamespace(pooler, 'timesheet_db', sameInstance)
    )
  })

  it('keeps distinct databases apart under a stable system identifier', () => {
    const serverA = target('MIGRATION_SOURCE_DB', 'postgresql://u:p@db-alias-1.corp:5432/timesheet_db', 'source')
    const stable = '7123456789012345678'
    // A second database on the same server is a different dataset.
    expect(computeDatabaseNamespace(serverA, 'timesheet_db', stable)).not.toBe(
      computeDatabaseNamespace(serverA, 'other_db', stable)
    )
  })

  it('prefers the system identifier when the probe is available', () => {
    const target1 = target('MIGRATION_SOURCE_DB', 'postgresql://u:p@db-host-1.corp:5432/timesheet_db', 'source')
    const target2 = target('MIGRATION_TARGET_DB', 'postgresql://u:p@db-host-2.corp:5432/timesheet_db', 'destination')
    const shared = '7123456789012345678'
    expect(computeDatabaseNamespace(target1, 'timesheet_db', shared)).toBe(
      computeDatabaseNamespace(target2, 'timesheet_db', shared)
    )
    expect(computeDatabaseNamespace(target1, 'timesheet_db', shared)).not.toBe(
      computeDatabaseNamespace(target1, 'timesheet_db', '8999999999999999999')
    )
  })
})

describe('migration diagnostic redaction', () => {
  it('removes connection strings, bearer credentials, JWTs, and Supabase keys from free-form errors', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signature-part'
    const message = [
      'request failed',
      'postgresql://operator:password@db.example.test:5432/app',
      'Authorization: Bearer bearer-secret-value',
      `jwt=${jwt}`,
      'service_role_key=sb_secret_live-development-value',
      'SUPABASE_SERVICE_ROLE_KEY=opaque-service-value',
      'refresh_token=opaque-refresh-value',
      'bearer=opaque-bearer-value',
    ].join(' ')

    const redacted = redactString(message)
    expect(redacted).toContain('request failed')
    expect(redacted).toContain('[redacted-connection]')
    expect(redacted).not.toContain('password@')
    expect(redacted).not.toContain('bearer-secret-value')
    expect(redacted).not.toContain(jwt)
    expect(redacted).not.toContain('sb_secret_live-development-value')
    expect(redacted).not.toContain('opaque-service-value')
    expect(redacted).not.toContain('opaque-refresh-value')
    expect(redacted).not.toContain('opaque-bearer-value')
  })

  it('deep-redacts secret-shaped fields and free-form nested strings', () => {
    expect(redactResult({
      serviceRoleKey: 'field-secret',
      detail: 'provider rejected Bearer nested-secret',
    })).toEqual({
      serviceRoleKey: '[redacted]',
      detail: 'provider rejected Bearer [redacted]',
    })
  })
})

describe('CLI exit-code classification', () => {
  it('refuses raw gate opening even when an older run was published', async () => {
    let transactions = 0
    const result = await run(
      ['gate', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--state', 'open', '--run-id', 'run-a', '--reason', 'stale publication', '--json'],
      {
        env: { MIGRATION_TARGET_DB: 'postgresql://u:p@127.0.0.1:5433/target_db' },
        openWrite: () => ({
          identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
          query: async () => [{ state: 'fenced', run_id: 'run-b', fence_generation: 'generation-b', reason: 'new run', updated_at: '2026-09-23T00:00:00Z', updated_by: 'operator' }],
          transaction: async () => { transactions++; return [] },
          close: async () => {},
        }) as never,
      }
    )
    expect(result.code).toBe(EXIT_CODES.VALIDATION)
    expect(result.json?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'E_PUBLICATION_REQUIRED' })]))
    expect(transactions).toBe(0)
  })

  it('redacts free-form credentials from unexpected driver errors', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signature-part'
    const result = await run(['inspect', '--source', 'native', '--source-env', 'MIGRATION_SOURCE_DB'], {
      env: { MIGRATION_SOURCE_DB: 'postgresql://u:p@127.0.0.1:5432/source_db' },
      openSession: () => {
        throw new Error(`driver failed Authorization: Bearer bearer-secret jwt=${jwt}`)
      },
    })

    const diagnostic = result.err.join('\n')
    expect(diagnostic).toContain('driver failed')
    expect(diagnostic).not.toContain('bearer-secret')
    expect(diagnostic).not.toContain(jwt)
  })

  it('maps an operator-actionable refusal to the BLOCKED exit code', async () => {
    const result = await run(
      ['gate', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--state', 'fenced', '--reason', 'window'],
      {
        env: { MIGRATION_TARGET_DB: 'postgresql://u:p@127.0.0.1:5433/target_db' },
        openWrite: () =>
          ({
            provider: 'native',
            displayTarget: 'test',
            identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
            query: async () => [],
            transaction: async () => {
              throw new MigrationRunError('E_GATE_MISSING', 'The destination has no write-gate table.')
            },
            close: async () => {},
          }) as never,
      }
    )
    expect(result.code).toBe(EXIT_CODES.BLOCKED)
    expect(result.err.join('\n')).toContain('E_GATE_MISSING')
  })

  it('exits BLOCKED when apply refuses a gate-less destination before any write', async () => {
    // A minimal resolved plan: the CLI must refuse it on a destination whose
    // gate table is absent, with the operator-actionable BLOCKED exit.
    const rows = {} as Record<MigrationEntity, unknown[]>
    for (const entity of ENTITY_ORDER) rows[entity] = []
    const catalog: CatalogInspection = {
      tables: [...ENTITY_ORDER],
      columns: ENTITY_ORDER.flatMap((entity) =>
        entitySpec(entity).columns.map((column) => ({
          table: entity,
          column: column.name,
          udtName:
            (entity === 'titles' || entity === 'whitelisted_domains') && column.name === 'id'
              ? 'text'
              : KIND_ACCEPTED_UDTS[column.kind][0],
          nullable: column.nullable,
        }))
      ),
      hasAuthSchema: false,
      hasNativeMigrationLedger: true,
      hasSupabaseMigrationLedger: false,
    }
    const plan = buildPreview(
      {
        manifest: makeManifest(),
        provenance: [],
        sourceRows: rows as never,
        target: { provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime', rows: rows as never, identities: [], receipts: [] },
        targetApplicationVersion: '1.0.3',
        targetSchemaFingerprint: computeSchemaFingerprint(catalog, 'native'),
      },
      { runId: 'planning-run', createdAt: '2026-09-19T10:00:00.000000Z' }
    )
    const outcome = resolvePlan(plan, {
      format: RESOLUTIONS_FORMAT,
      formatVersion: RESOLUTIONS_FORMAT_VERSION,
      planDigest: plan.planDigest,
      operator: { name: 'Operator', at: '2026-09-19T10:00:00.000000Z' },
      decisions: [],
    })
    if (!outcome.resolvedPlan) throw new Error('the empty plan must resolve')
    const planPath = join(tempDir('apply-refusal'), 'resolved.json')
    writeFileSync(planPath, JSON.stringify(outcome.resolvedPlan))

    const result = await run(
      [
        'apply',
        '--target',
        'native',
        '--target-env',
        'MIGRATION_TARGET_DB',
        '--plan',
        planPath,
        '--expect-plan-digest',
        plan.planDigest,
        '--run-id',
        'apply-run-1',
        '--json',
      ],
      {
        env: { MIGRATION_TARGET_DB: 'postgresql://u:p@127.0.0.1:5433/target_db' },
        openWrite: () =>
          ({
            provider: 'native',
            displayTarget: 'test',
            identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
            inspectCatalog: async () => catalog,
            migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
            query: async (sql: string) => {
              if (sql.includes('migration_write_gate')) {
                throw Object.assign(new Error('relation "public.migration_write_gate" does not exist'), {
                  code: '42P01',
                })
              }
              return []
            },
            transaction: async () => {
              throw new Error('a refused apply must never open the apply transaction')
            },
            close: async () => {},
          }) as never,
      }
    )
    expect(result.code).toBe(EXIT_CODES.BLOCKED)
    expect(result.err.join('\n')).toContain('E_GATE_MISSING')
  })

  it('keeps a genuine environment failure on the ENVIRONMENT exit code', async () => {
    const result = await run(['inspect', '--source', 'native', '--source-env', 'MIGRATION_SOURCE_DB'], {
      env: { MIGRATION_SOURCE_DB: 'postgresql://u:p@127.0.0.1:5432/source_db' },
      openSession: () =>
        ({
          provider: 'native',
          displayTarget: 'test',
          identity: async () => {
            throw new MigrationRunError('E_AUTH_DB_MISMATCH', 'Auth endpoint does not match the database.')
          },
          assertReadOnly: async () => {
            throw new MigrationRunError('E_AUTH_DB_MISMATCH', 'Auth endpoint does not match the database.')
          },
          query: async () => [],
          inspectCatalog: async () => {
            throw new Error('unreachable')
          },
          withReadOnlyTransaction: async (fn: () => Promise<unknown>) => fn(),
          countRows: async () => 0,
          migrationLedger: async () => [],
          close: async () => {},
        }) as never,
    })
    expect(result.code).toBe(EXIT_CODES.ENVIRONMENT)
    expect(result.err.join('\n')).toContain('E_AUTH_DB_MISMATCH')
  })
})
// migrations/tool/tests/migration-cli.test.ts

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalStringify, sha256Hex, type ProviderName } from '../src/format'
import { MigrationRunError } from '../src/journal'
import type { CatalogInspection } from '../src/schema'
import type { DatabaseIdentity, DatabaseSession } from '../src/providers/session'
import {
  RETIREMENT_DECLARATION_FORMAT,
  captureRetirementEvidence,
  parseRetirementDeclaration,
  type RetirementDeclaration,
} from '../src/retirement-inventory'
import { EXIT_CODES, runCli } from '../src/cli'

const REQUIRED_COLUMNS: Record<string, string[]> = {
  migration_runs: ['state', 'source_namespace', 'committed_at'],
  migration_record_map: ['source_namespace', 'entity', 'run_id'],
  migration_record_dispositions: ['entity', 'action'],
  migration_retry_history: ['operation', 'outcome', 'created_at'],
  migration_fresh_keys: ['operation', 'fence_generation', 'issued_at', 'expires_at'],
  migration_write_gate: ['id', 'state', 'fence_generation', 'updated_at'],
}

function declaration(over: Partial<RetirementDeclaration> = {}): RetirementDeclaration {
  return {
    format: RETIREMENT_DECLARATION_FORMAT,
    formatVersion: 1,
    deployment: {
      label: 'prod-native',
      environment: 'production',
      provider: 'native',
      applicationRelease: '1.0.3',
      expectedNamespace: 'native:11111111111111111111111111111111',
    },
    provenance: {
      declaredAt: '2026-09-27T00:00:00.000Z',
      validUntil: '2026-10-04T00:00:00.000Z',
      evidenceRef: 'change:phase4-inventory',
      toolRevision: 'abcdef0',
      toolDirtyState: 'clean',
    },
    capabilities: {
      backendSelection: 'native',
      durableIdempotency: 'enabled',
      mobileBearerAuth: 'disabled',
      portableRetry: 'enabled',
      freshTicketIssuance: 'enabled',
    },
    clientInventory: {
      state: 'complete',
      noKnownClients: true,
      clients: [],
    },
    queueConsumers: {
      status: 'none',
      policy: 'none',
    },
    ...over,
  }
}

interface FakeOptions {
  provider?: ProviderName
  missingRelation?: string
  filteredRelation?: string
  runState?: string
  missingRunLinks?: string
}

function fakeSession(options: FakeOptions = {}): DatabaseSession & { queries: string[]; closed: boolean } {
  const provider = options.provider ?? 'native'
  const queries: string[] = []
  let closed = false
  const identity: DatabaseIdentity = {
    provider,
    namespace: `${provider}:11111111111111111111111111111111`,
    runtimeFingerprint: 'runtime-a',
    database: 'test',
    serverVersion: '17.6',
    postmasterStartedAt: '2026-09-27 00:00:00+00',
    systemIdentifier: null,
    displayTarget: 'test',
  }

  return {
    provider,
    displayTarget: 'test',
    queries,
    get closed() { return closed },
    async identity() { return identity },
    async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
      queries.push(sql)
      if (!/^\s*select\b/i.test(sql)) throw new Error('Only SELECT is allowed in the fake.')
      if (sql.includes('retirement-inventory:visibility')) {
        return Object.keys(REQUIRED_COLUMNS)
          .filter((relation) => relation !== options.missingRelation)
          .map((relation) => ({
            relation,
            row_security: relation === options.filteredRelation,
            force_row_security: false,
            owns_table: relation !== options.filteredRelation,
            role_superuser: false,
            role_bypass_rls: false,
          })) as unknown as T[]
      }
      if (sql.includes('retirement-inventory:columns')) {
        return Object.entries(REQUIRED_COLUMNS).flatMap(([relation, columns]) =>
          columns.map((column_name) => ({ relation, column_name }))) as unknown as T[]
      }
      if (sql.includes('retirement-inventory:clock')) {
        return [{ snapshot_at: '2026-09-27 01:00:00+00' }] as unknown as T[]
      }
      if (sql.includes('retirement-inventory:gate')) {
        return [{ state: 'open', generation_present: true, updated_at: '2026-09-27 00:30:00+00', row_count: '1' }] as unknown as T[]
      }
      if (sql.includes('retirement-inventory:runs')) {
        return [{ state: options.runState ?? 'writable', count: '1', earliest: '2026-09-26 01:00:00+00', latest: '2026-09-26 01:00:00+00' }] as unknown as T[]
      }
      if (sql.includes('retirement-inventory:mapping-summary')) {
        return [{ namespace_count: '1', missing_run_links: options.missingRunLinks ?? '0' }] as unknown as T[]
      }
      if (sql.includes('retirement-inventory:mappings')) {
        return [{ entity: 'projects', count: '2' }] as unknown as T[]
      }
      if (sql.includes('retirement-inventory:dispositions')) {
        return [{ entity: 'projects', action: 'map', count: '2' }] as unknown as T[]
      }
      if (sql.includes('retirement-inventory:retry-history')) {
        return [{ operation: 'create_reminder', outcome: 'committed', count: '3', earliest: '2026-09-20 00:00:00+00', latest: '2026-09-21 00:00:00+00' }] as unknown as T[]
      }
      if (sql.includes('retirement-inventory:fresh-tickets')) {
        return [{ operation: 'create_reminder', bucket: 'current-generation-unexpired', count: '4', earliest_issued: '2026-09-27 00:00:00+00', latest_expiry: '2027-01-02 00:00:00+00' }] as unknown as T[]
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
    async withReadOnlyTransaction<T>(fn: () => Promise<T>): Promise<T> { return fn() },
    async assertReadOnly() { throw new Error('retirement inventory must not invoke a DDL probe') },
    async inspectCatalog(): Promise<CatalogInspection> { throw new Error('not used') },
    async countRows(): Promise<number> { throw new Error('not used') },
    async migrationLedger() { return ['0037_migration_fresh_keys.sql', '0036_migration_write_gate_generation.sql'] },
    async close() { closed = true },
  }
}

describe('Phase 4 retirement evidence inventory', () => {
  const tempDirs: string[] = []
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('captures aggregate-only evidence in one read-only snapshot with a verifiable digest', async () => {
    const session = fakeSession()
    const result = await captureRetirementEvidence(
      session,
      'native',
      declaration(),
      new Date('2026-09-27T00:59:00.000Z'),
      () => new Date('2026-09-27T01:00:01.000Z')
    )

    expect(result.blocked).toBe(false)
    expect(result.artifact).toMatchObject({
      purpose: 'evidence-only',
      gateAssessment: 'not-performed',
      database: { provider: 'native', identityBinding: 'matched', evidenceVisibility: 'complete' },
      observations: {
        mappings: { sourceNamespaceCount: 1, missingRunLinkCount: 0 },
        retainedIssuedTickets: [{ count: 4, bucket: 'current-generation-unexpired' }],
      },
      unresolved: [],
    })
    const { artifactDigest, ...body } = result.artifact
    expect(artifactDigest).toBe(sha256Hex(canonicalStringify(body)))
    expect(session.queries.every((query) => /^\s*select\b/i.test(query))).toBe(true)
    expect(session.queries.join('\n')).toContain('transaction_timestamp()')
    expect(session.queries.join('\n')).toContain('ticket.fence_generation = gate.fence_generation')
    const serialized = JSON.stringify(result.artifact)
    expect(serialized).not.toContain('ticket-secret')
    expect(serialized).not.toContain('actor_id')
    expect(serialized).not.toContain('source_id')
    expect(serialized).not.toContain('run_id')
  })

  it('publishes unresolved declaration facts as blocked evidence without a readiness decision', async () => {
    const session = fakeSession({ missingRunLinks: '2' })
    const base = declaration()
    const result = await captureRetirementEvidence(session, 'native', declaration({
      deployment: { ...base.deployment, applicationRelease: 'unknown', expectedNamespace: 'unknown' },
      provenance: { ...base.provenance, validUntil: '2026-09-27T00:30:00.000Z', toolRevision: 'unknown', toolDirtyState: 'unknown' },
      capabilities: { ...base.capabilities, portableRetry: 'unknown' },
      clientInventory: { state: 'unknown', noKnownClients: true, clients: [] },
      queueConsumers: { status: 'unknown', policy: 'unknown' },
    }), new Date('2026-09-27T00:59:00.000Z'), () => new Date('2026-09-27T01:00:01.000Z'))

    expect(result.blocked).toBe(true)
    expect(result.artifact.unresolved).toEqual(expect.arrayContaining([
      'DECLARATION_STALE',
      'EXPECTED_NAMESPACE_UNKNOWN',
      'CAPABILITY_PORTABLE_RETRY_UNKNOWN',
      'CLIENT_INVENTORY_INCOMPLETE',
      'QUEUE_CONSUMERS_UNKNOWN',
      'MAPPING_RUN_LINK_MISSING',
    ]))
    expect(result.artifact).toMatchObject({ gateAssessment: 'not-performed' })

    const futureResult = await captureRetirementEvidence(fakeSession(), 'native', declaration({
      provenance: {
        ...base.provenance,
        declaredAt: '2026-09-27T02:00:00.000Z',
        validUntil: '2026-09-27T03:00:00.000Z',
        toolDirtyState: 'dirty',
      },
    }), new Date('2026-09-27T00:59:00.000Z'), () => new Date('2026-09-27T01:00:01.000Z'))
    expect(futureResult.artifact.unresolved).toEqual(expect.arrayContaining([
      'DECLARATION_FROM_FUTURE',
      'TOOL_WORKTREE_DIRTY',
    ]))
  })

  it('fails closed when a relation is missing or row visibility is filtered', async () => {
    await expect(captureRetirementEvidence(
      fakeSession({ missingRelation: 'migration_fresh_keys' }),
      'native', declaration(), new Date(), () => new Date()
    )).rejects.toMatchObject({ code: 'E_RETIREMENT_EVIDENCE_BLOCKED' })

    await expect(captureRetirementEvidence(
      fakeSession({ filteredRelation: 'migration_retry_history' }),
      'native', declaration(), new Date(), () => new Date()
    )).rejects.toMatchObject({ code: 'E_RETIREMENT_VISIBILITY_UNVERIFIED' })
  })

  it('rejects provider mismatches, unsupported grouped values, and ambiguous empty client declarations', async () => {
    expect(() => parseRetirementDeclaration({
      ...declaration(),
      clientInventory: { state: 'complete', noKnownClients: false, clients: [] },
    })).toThrow(/invalid/i)

    await expect(captureRetirementEvidence(
      fakeSession(), 'supabase', declaration(), new Date(), () => new Date()
    )).rejects.toMatchObject({ code: 'E_RETIREMENT_PROVIDER_MISMATCH' })

    await expect(captureRetirementEvidence(
      fakeSession({ runState: 'invented-state' }), 'native', declaration(), new Date(), () => new Date()
    )).rejects.toBeInstanceOf(MigrationRunError)
  })

  it('exposes an additive CLI command, writes exclusively, and returns BLOCKED for unresolved declarations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vsis-retirement-inventory-'))
    tempDirs.push(dir)
    const manifest = join(dir, 'declaration.json')
    const out = join(dir, 'evidence.json')
    const base = declaration()
    writeFileSync(manifest, JSON.stringify({
      ...base,
      deployment: { ...base.deployment, expectedNamespace: 'unknown' },
    }))
    const session = fakeSession()
    const stdout: string[] = []
    const stderr: string[] = []
    const args = [
      'retirement-inventory',
      '--target', 'native',
      '--target-env', 'MIGRATION_RETIREMENT_TEST_URL',
      '--manifest', manifest,
      '--out', out,
      '--json',
    ]
    const deps = {
      cwd: dir,
      env: { MIGRATION_RETIREMENT_TEST_URL: 'postgres://operator:secret@localhost:5432/test' },
      openSession: vi.fn(() => session),
      now: () => new Date('2026-09-27T01:00:00.000Z'),
      out: (line: string) => stdout.push(line),
      err: (line: string) => stderr.push(line),
    }

    expect(await runCli(args, deps)).toBe(EXIT_CODES.BLOCKED)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({
      purpose: 'evidence-only',
      gateAssessment: 'not-performed',
      unresolved: ['EXPECTED_NAMESPACE_UNKNOWN'],
    })
    expect(stdout.join('\n')).not.toContain('operator:secret')
    expect(stderr.join('\n')).not.toContain('operator:secret')
    expect(session.closed).toBe(true)

    const original = readFileSync(out, 'utf8')
    expect(await runCli(args, { ...deps, openSession: () => fakeSession() })).not.toBe(EXIT_CODES.OK)
    expect(readFileSync(out, 'utf8')).toBe(original)
  })
})

// tests/migration-fence.test.ts
// Provider-level write fence (plan §11): the inventory is exact, activation
// revokes DML only, verification proves denial with real write attempts, and
// release restores the recorded grants exactly. The CLI release is gated on
// durable publication or an explicit recovery decision.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activateFence,
  createFenceArtifact,
  inventoryFence,
  parseFenceArtifact,
  parseFenceRoles,
  releaseFence,
  verifyFence,
  verifySupabaseRestFence,
} from '@vsis/migration-tool/providers/fence'
import { EXIT_CODES, runCli } from '@vsis/migration-tool/cli'
import type { WriteSession } from '@vsis/migration-tool/providers/session'

const tmpRoot = mkdtempSync(join(tmpdir(), 'vsis-migration-fence-'))
const NOW = '2026-09-22T00:00:00.000Z'
const GENERATION_A = '11111111-1111-4111-8111-111111111111'
const GENERATION_B = '22222222-2222-4222-8222-222222222222'
type GateFixture = 'missing-table' | 'missing-row' | {
  state: 'fenced' | 'open'
  runId?: string | null
  updatedAt?: string
  generation?: string
}

function gateRow(gate: Exclude<GateFixture, 'missing-table' | 'missing-row'> = { state: 'fenced' }) {
  return {
    state: gate.state,
    run_id: gate.runId ?? 'run-1',
    fence_generation: gate.generation ?? GENERATION_A,
    reason: 'migration window',
    updated_at: gate.updatedAt ?? NOW,
    updated_by: 'operator@example.com',
  }
}

type GrantFixture = {
  grantee: string
  table_name: string
  privileges: string[]
  grantor?: string
  is_grantable?: string
  current_user?: string
}

function tableGrantRows(grants: GrantFixture[], wanted: string[]) {
  return grants.flatMap((row) => row.privileges
    .filter((privilege) => wanted.includes(privilege))
    .map((privilege) => ({
      grantee: row.grantee,
      table_name: row.table_name,
      privilege_type: privilege,
      grantor: row.grantor ?? 'migration_operator',
      is_grantable: row.is_grantable ?? 'NO',
      current_user: row.current_user ?? 'migration_operator',
    })))
}

function fakeSession(options: {
  grants?: GrantFixture[]
  columnGrants?: Array<{ grantee: string; table_name: string; column_name: string; privilege_type: string }>
  probeError?: Error & { code?: string }
  setRoleError?: Error & { code?: string }
  probeSucceeds?: boolean
  gate?: GateFixture
}) {
  const statements: string[] = []
  const session = {
    provider: 'native',
    displayTarget: 'test',
    identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      statements.push(sql)
      if (sql.includes('migration_write_gate')) {
        if (options.gate === 'missing-table') throw Object.assign(new Error('missing gate table'), { code: '42P01' })
        if (options.gate === 'missing-row') return []
        return [gateRow(options.gate)]
      }
      if (sql.includes('role_table_grants')) {
        // Mirror the query's own privilege filter.
        const wanted = (params?.[1] as string[]) ?? []
        return tableGrantRows(options.grants ?? [], wanted)
      }
      if (sql.includes('pg_catalog.pg_attribute')) {
        return options.columnGrants ?? []
      }
      return []
    }),
    transaction: vi.fn(async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) =>
      fn({
        query: async (sql: string) => {
          statements.push(sql)
          if (sql.includes('migration_write_gate')) {
            if (options.gate === 'missing-table') throw Object.assign(new Error('missing gate table'), { code: '42P01' })
            if (options.gate === 'missing-row') return []
            return [gateRow(options.gate)]
          }
          if (sql.includes('role_table_grants')) return tableGrantRows(options.grants ?? [], ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
          if (sql.includes('pg_catalog.pg_attribute')) return options.columnGrants ?? []
          if (sql.includes('set local role') && options.setRoleError) throw options.setRoleError
          if (sql.includes('update public.app_settings')) {
            if (options.probeSucceeds) return []
            throw options.probeError ?? Object.assign(new Error('permission denied'), { code: '42501' })
          }
          return []
        },
      })
    ),
    close: async () => {},
  } as unknown as WriteSession
  return { session, statements }
}

describe('fence roles', () => {
  it('defaults Supabase to anon/authenticated and requires explicit native roles', () => {
    expect(parseFenceRoles(undefined, 'supabase')).toEqual(['anon', 'authenticated'])
    expect(() => parseFenceRoles(undefined, 'native')).toThrow('writer role')
  })

  it('parses a comma-separated list and rejects invalid identifiers', () => {
    expect(parseFenceRoles('anon, authenticated', 'supabase')).toEqual(['anon', 'authenticated'])
    expect(() => parseFenceRoles('anon; drop table x', 'supabase')).toThrow('not a valid PostgreSQL identifier')
    expect(() => parseFenceRoles('', 'native')).toThrow('writer role')
    expect(() => parseFenceRoles('anon,anon', 'supabase')).toThrow('must not be duplicated')
  })
})

describe('fence lifecycle', () => {
  it('captures the exact DML grants for the fenced roles', async () => {
    const { session, statements } = fakeSession({
      grants: [
        { grantee: 'app_role', table_name: 'timesheets', privileges: ['INSERT', 'UPDATE'] },
        { grantee: 'app_role', table_name: 'app_settings', privileges: ['SELECT'] },
      ],
    })
    const inventory = await inventoryFence(session, 'native', ['app_role'])
    // SELECT is not a fenced privilege, so it never appears in the inventory.
    expect(inventory).toEqual({
      provider: 'native',
      roles: ['app_role'],
      grants: [{ role: 'app_role', table: 'timesheets', privileges: ['INSERT', 'UPDATE'] }],
    })
    expect(statements.join('\n')).toContain('pg_catalog.pg_attribute')
  })

  it('refuses ACL shapes that this direct table-grant primitive cannot restore exactly', async () => {
    const unsupported = [
      fakeSession({ grants: [{ grantee: 'app_role', table_name: 'timesheets', privileges: ['INSERT'], is_grantable: 'YES' }] }).session,
      fakeSession({ grants: [{ grantee: 'app_role', table_name: 'timesheets', privileges: ['UPDATE'], grantor: 'different_operator' }] }).session,
      fakeSession({ columnGrants: [{ grantee: 'app_role', table_name: 'timesheets', column_name: 'hours', privilege_type: 'UPDATE' }] }).session,
    ]
    for (const session of unsupported) {
      await expect(inventoryFence(session, 'native', ['app_role'])).rejects.toMatchObject({ code: 'E_FENCE_UNSUPPORTED_ACL' })
    }
  })

  it('revokes exactly the fenced privileges per role and restores the recorded grants', async () => {
    const inventory = {
      provider: 'native' as const,
      roles: ['app_role'],
      grants: [{ role: 'app_role', table: 'timesheets', privileges: ['INSERT', 'UPDATE'] }],
    }
    const activated = fakeSession({})
    await activateFence(activated.session, ['app_role'])
    expect(activated.statements.join('\n')).toContain(
      'revoke INSERT, UPDATE, DELETE, TRUNCATE on all tables in schema public from "app_role"'
    )

    const released = fakeSession({})
    await releaseFence(released.session, inventory)
    const sql = released.statements.join('\n')
    expect(sql).toContain('revoke INSERT, UPDATE, DELETE, TRUNCATE on all tables in schema public from "app_role"')
    expect(sql).toContain('grant INSERT, UPDATE')
    expect(sql).toContain('on table public."timesheets" to "app_role"')
  })

  it('proves denial with a real write attempt and reports an unfenced role as a failed check', async () => {
    const fenced = fakeSession({})
    const denied = await verifyFence(fenced.session, ['app_role'])
    expect(denied.ok).toBe(true)
    expect(denied.checks[0]).toMatchObject({ surface: 'sql:app_role', ok: true })

    const unfenced = fakeSession({ probeSucceeds: true })
    const admitted = await verifyFence(unfenced.session, ['app_role'])
    expect(admitted.ok).toBe(false)
    expect(admitted.checks[0].detail).toContain('write attempt succeeded while fenced')

    const broken = fakeSession({
      probeError: Object.assign(new Error('cannot assume role'), { code: '0B000' }),
    })
    const unexpected = await verifyFence(broken.session, ['app_role'])
    expect(unexpected.ok).toBe(false)
    expect(unexpected.checks[0].detail).toContain('probe failed unexpectedly')

    const deniedRole = fakeSession({
      setRoleError: Object.assign(new Error('permission denied to set role'), { code: '42501' }),
    })
    const rejectedRole = await verifyFence(deniedRole.session, ['app_role'])
    expect(rejectedRole.ok).toBe(false)
    expect(rejectedRole.checks[0].detail).toContain('role assumption failed')
  })
})

describe('Supabase REST fence verification', () => {
  afterEach(() => vi.unstubAllGlobals())

  const options = { restUrl: 'https://example.test', accessToken: 'token', anonKey: 'anon', userId: 'user-1' }
  const readableProfile = () => new Response(JSON.stringify([{ name: 'Probe' }]), { status: 200 })

  it('accepts only the expected PostgREST permission denial', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(readableProfile())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '42501' }), { status: 403 })))
    await expect(verifySupabaseRestFence(options)).resolves.toMatchObject({ ok: true })
  })

  it('rejects unrelated and non-JSON REST failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(readableProfile())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '42501' }), { status: 500 })))
    await expect(verifySupabaseRestFence(options)).resolves.toMatchObject({ ok: false })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(readableProfile())
      .mockResolvedValueOnce(new Response('gateway error', { status: 502 })))
    await expect(verifySupabaseRestFence(options)).resolves.toMatchObject({ ok: false })
  })

  it('rejects a successful REST write', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(readableProfile())
      .mockResolvedValueOnce(new Response(null, { status: 204 })))
    await expect(verifySupabaseRestFence(options)).resolves.toMatchObject({ ok: false })
  })
})

describe('fence inventory artifacts', () => {
  it('rejects malformed, duplicate, and digest-mismatched inventory artifacts', () => {
    const artifact = createFenceArtifact({
      provider: 'native', roles: ['app_role'], grants: [{ role: 'app_role', table: 'timesheets', privileges: ['INSERT'] }],
    }, { capturedFor: 'native:target', runId: 'run-1', gateUpdatedAt: NOW, gateGeneration: GENERATION_A, reason: 'window', actor: 'operator', capturedAt: NOW })
    expect(parseFenceArtifact(artifact)).toMatchObject({ runId: 'run-1', inventoryDigest: artifact.inventoryDigest })
    expect(() => parseFenceArtifact({ ...artifact, roles: ['app_role', 'app_role'] })).toThrow('roles must not be duplicated')
    expect(() => parseFenceArtifact({ ...artifact, gateUpdatedAt: '' })).toThrow('gateUpdatedAt is invalid')
    expect(() => parseFenceArtifact({ ...artifact, gateGeneration: '' })).toThrow('gateGeneration is invalid')
    expect(() => parseFenceArtifact({ ...artifact, gateGeneration: 'not-a-uuid' })).toThrow('must be a UUID')
    expect(() => parseFenceArtifact({ ...artifact, inventoryDigest: '0'.repeat(64) })).toThrow('digest does not match')
  })
})

describe('fence CLI release gating', () => {
  const env = { MIGRATION_TARGET_DB: 'postgresql://u:p@127.0.0.1:5433/target_db' }

  function writeSessionWithReceipts(
    receipts: Array<{ state: string }>,
    grants: GrantFixture[] = [],
    gate: GateFixture = { state: 'fenced' },
    transactionStatements?: string[]
  ) {
    const query = async (sql: string, params?: unknown[]) => {
      if (sql.includes('migration_write_gate')) {
        if (gate === 'missing-table') throw Object.assign(new Error('missing gate table'), { code: '42P01' })
        if (gate === 'missing-row') return []
        return [gateRow(gate)]
      }
      if (sql.includes('role_table_grants')) {
        const wanted = (params?.[1] as string[]) ?? []
        return tableGrantRows(grants, wanted)
      }
      if (sql.includes('pg_catalog.pg_attribute')) {
        return []
      }
      if (sql.includes('from public.migration_runs') || sql.includes('from public.migration_record_map')) {
        return receipts.map((receipt) => ({ ...receipt, run_id: 'run-1' }))
      }
      return []
    }
    return {
      provider: 'native',
      displayTarget: 'test',
      identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
      query,
      transaction: async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>) =>
        fn({ query: async (sql, params) => {
          transactionStatements?.push(sql)
          return query(sql, params)
        } }),
      close: async () => {},
    } as unknown as WriteSession
  }

  function writeArtifact(path: string, capturedFor = 'native:target', gateUpdatedAt = NOW, gateGeneration = GENERATION_A) {
    writeFileSync(path, JSON.stringify(createFenceArtifact({
      provider: 'native',
      roles: ['app_role'],
      grants: [{ role: 'app_role', table: 'timesheets', privileges: ['INSERT'] }],
    }, {
      capturedFor,
      runId: 'run-1',
      gateUpdatedAt,
      gateGeneration,
      reason: 'migration window',
      actor: 'operator@example.com',
      capturedAt: NOW,
    })))
  }

  it('refuses an unrestricted release without a durably published receipt', async () => {
    const inventoryPath = join(tmpRoot, `fence-inv-gated-${Math.random().toString(36).slice(2, 8)}.json`)
    writeArtifact(inventoryPath)
    const out: string[] = []
    const code = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'release', '--role', 'app_role', '--reason', 'window over', '--inventory', inventoryPath, '--json'],
      { env, openWrite: () => writeSessionWithReceipts([{ state: 'verified' }], [], { state: 'open' }), out: (line) => out.push(line) }
    )
    expect(code).toBe(EXIT_CODES.VALIDATION)
    expect(out.join('\n')).toContain('E_FENCE_RELEASE_GATED')
    rmSync(inventoryPath)
  })

  it('releases through the recorded --recovery decision and proves exact restoration', async () => {
    const inventoryPath = join(tmpRoot, `fence-inv-${Math.random().toString(36).slice(2, 8)}.json`)
    const grants = [{ role: 'app_role', table: 'timesheets', privileges: ['INSERT'] }]
    writeArtifact(inventoryPath)
    const out: string[] = []
    const code = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'release', '--role', 'app_role', '--reason', 'pre-publication recovery', '--recovery', '--inventory', inventoryPath, '--json'],
      {
        env,
        openWrite: () =>
          writeSessionWithReceipts(
            [],
            grants.map((grant) => ({ grantee: grant.role, table_name: grant.table, privileges: grant.privileges }))
          ),
        out: (line) => out.push(line),
      }
    )
    expect(code).toBe(EXIT_CODES.OK)
    const result = JSON.parse(out.join('\n')) as { ok: boolean; recovery: boolean; grantsRestoredExactly: boolean }
    expect(result.ok).toBe(true)
    expect(result.recovery).toBe(true)
    expect(result.grantsRestoredExactly).toBe(true)
    expect(existsSync(inventoryPath)).toBe(true)
    rmSync(inventoryPath)
  })

  it('refuses release when the current fence is a different run or generation, even with an old writable receipt and --recovery', async () => {
    for (const gate of [
      { state: 'fenced' as const, runId: 'newer-run' },
      { state: 'fenced' as const, runId: 'run-1', updatedAt: '2026-09-22T00:00:01.000Z' },
      { state: 'fenced' as const, runId: 'run-1', generation: GENERATION_B },
    ]) {
      const inventoryPath = join(tmpRoot, `fence-inv-stale-${Math.random().toString(36).slice(2, 8)}.json`)
      writeArtifact(inventoryPath)
      const out: string[] = []
      const code = await runCli(
        ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'release', '--role', 'app_role', '--reason', 'operator recovery', '--recovery', '--inventory', inventoryPath, '--json'],
        { env, openWrite: () => writeSessionWithReceipts([{ state: 'writable' }], [], gate), out: (line) => out.push(line) }
      )
      expect(code).toBe(EXIT_CODES.VALIDATION)
      expect(out.join('\n')).toContain('E_FENCE_GATE_BINDING')
      rmSync(inventoryPath)
    }
  })

  it('releases a published run only after locking its open gate and writable receipt before restoring grants', async () => {
    const inventoryPath = join(tmpRoot, `fence-inv-published-${Math.random().toString(36).slice(2, 8)}.json`)
    const grants = [{ grantee: 'app_role', table_name: 'timesheets', privileges: ['INSERT'] }]
    const transactionStatements: string[] = []
    writeArtifact(inventoryPath)
    const out: string[] = []
    const code = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'release', '--role', 'app_role', '--reason', 'published window over', '--inventory', inventoryPath, '--json'],
      {
        env,
        openWrite: () => writeSessionWithReceipts([{ state: 'writable' }], grants, { state: 'open' }, transactionStatements),
        out: (line) => out.push(line),
      }
    )
    expect(code).toBe(EXIT_CODES.OK)
    const gateLock = transactionStatements.findIndex((sql) => sql.includes('migration_write_gate') && sql.includes('for update'))
    const receiptLock = transactionStatements.findIndex((sql) => sql.includes('migration_runs') && sql.includes('for update'))
    const firstRestore = transactionStatements.findIndex((sql) => sql.startsWith('revoke INSERT'))
    expect(gateLock).toBeGreaterThanOrEqual(0)
    expect(receiptLock).toBeGreaterThan(gateLock)
    expect(firstRestore).toBeGreaterThan(receiptLock)
    rmSync(inventoryPath)
  })

  it('refuses normal release while the same run remains fenced, even if its receipt is writable', async () => {
    const inventoryPath = join(tmpRoot, `fence-inv-fenced-${Math.random().toString(36).slice(2, 8)}.json`)
    writeArtifact(inventoryPath)
    const out: string[] = []
    const code = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'release', '--role', 'app_role', '--reason', 'window over', '--inventory', inventoryPath, '--json'],
      { env, openWrite: () => writeSessionWithReceipts([{ state: 'writable' }]), out: (line) => out.push(line) }
    )
    expect(code).toBe(EXIT_CODES.VALIDATION)
    expect(out.join('\n')).toContain('E_FENCE_RELEASE_GATED')
    rmSync(inventoryPath)
  })

  it('refuses artifact A after a newer same-run window B has opened and become writable', async () => {
    const inventoryPath = join(tmpRoot, `fence-inv-newer-generation-${Math.random().toString(36).slice(2, 8)}.json`)
    writeArtifact(inventoryPath)
    const out: string[] = []
    const code = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'release', '--role', 'app_role', '--reason', 'window over', '--inventory', inventoryPath, '--json'],
      { env, openWrite: () => writeSessionWithReceipts([{ state: 'writable' }], [], { state: 'open', generation: GENERATION_B }), out: (line) => out.push(line) }
    )
    expect(code).toBe(EXIT_CODES.VALIDATION)
    expect(out.join('\n')).toContain('E_FENCE_RELEASE_GATED')
    rmSync(inventoryPath)
  })

  it('refuses an inventory artifact captured for a different destination', async () => {
    const inventoryPath = join(tmpRoot, `fence-inv-other-${Math.random().toString(36).slice(2, 8)}.json`)
    writeArtifact(inventoryPath, 'native:elsewhere')
    const out: string[] = []
    const code = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'release', '--role', 'app_role', '--reason', 'window over', '--recovery', '--inventory', inventoryPath, '--json'],
      { env, openWrite: () => writeSessionWithReceipts([]), out: (line) => out.push(line) }
    )
    expect(code).toBe(EXIT_CODES.VALIDATION)
    expect(out.join('\n')).toContain('E_FENCE_INVENTORY_MISMATCH')
    rmSync(inventoryPath)
  })
})

describe('fence CLI activation artifact', () => {
  it('captures the inventory before revocation and refuses to overwrite an existing artifact', async () => {
    const env = { MIGRATION_TARGET_DB: 'postgresql://u:p@127.0.0.1:5433/target_db' }
    const outPath = join(tmpRoot, `fence-act-${Math.random().toString(36).slice(2, 8)}.json`)
    const { session, statements } = fakeSession({
      grants: [{ grantee: 'app_role', table_name: 'timesheets', privileges: ['INSERT', 'UPDATE'] }],
    })
    const out: string[] = []
    const code = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'activate', '--role', 'app_role', '--reason', 'migration window', '--actor', 'operator@example.com', '--run-id', 'run-1', '--out', outPath, '--json'],
      { env, openWrite: () => session, out: (line) => out.push(line) }
    )
    expect(code).toBe(EXIT_CODES.OK)
    const recorded = JSON.parse(readFileSync(outPath, 'utf8')) as { grants: unknown[]; capturedFor: string }
    expect(recorded.capturedFor).toBe('native:target')
    expect(recorded.grants).toHaveLength(1)
    const gateLock = statements.findIndex((sql) => sql.includes('migration_write_gate') && sql.includes('for update'))
    const inventoryRead = statements.findIndex((sql) => sql.includes('role_table_grants'))
    const revoke = statements.findIndex((sql) => sql.startsWith('revoke INSERT'))
    expect(gateLock).toBeGreaterThanOrEqual(0)
    expect(inventoryRead).toBeGreaterThan(gateLock)
    expect(revoke).toBeGreaterThan(inventoryRead)
    expect(vi.mocked(session.transaction)).toHaveBeenCalledTimes(1)
    const first = out.join('\n')
    expect(first).toContain('inventoryArtifact')

    const err: string[] = []
    const { session: runTwoSession } = fakeSession({ gate: { state: 'fenced', runId: 'run-2' } })
    const second = await runCli(
      ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'activate', '--role', 'app_role', '--reason', 'again', '--actor', 'operator@example.com', '--run-id', 'run-2', '--out', outPath, '--json'],
      { env, openWrite: () => runTwoSession, err: (line) => err.push(line) }
    )
    expect(second).toBe(EXIT_CODES.USAGE)
    expect(err.join('\n')).toContain('E_FENCE_ARTIFACT_EXISTS')
    rmSync(outPath)
  })

  it('refuses activation until the durable gate is present, fenced, and bound to the requested run', async () => {
    const env = { MIGRATION_TARGET_DB: 'postgresql://u:p@127.0.0.1:5433/target_db' }
    for (const gate of [
      'missing-table' as const,
      'missing-row' as const,
      { state: 'open' as const },
      { state: 'fenced' as const, runId: 'different-run' },
    ]) {
      const outPath = join(tmpRoot, `fence-act-refused-${Math.random().toString(36).slice(2, 8)}.json`)
      const { session } = fakeSession({ gate })
      const out: string[] = []
      const err: string[] = []
      const code = await runCli(
        ['fence', '--target', 'native', '--target-env', 'MIGRATION_TARGET_DB', '--action', 'activate', '--role', 'app_role', '--reason', 'migration window', '--actor', 'operator@example.com', '--run-id', 'run-1', '--out', outPath, '--json'],
        { env, openWrite: () => session, out: (line) => out.push(line), err: (line) => err.push(line) }
      )
      expect(code).toBe(EXIT_CODES.VALIDATION)
      expect(err.join('\n')).toContain('E_FENCE_GATE_BINDING')
      expect(existsSync(outPath)).toBe(false)
    }
  })
})
// migrations/tool/tests/migration-fence.test.ts

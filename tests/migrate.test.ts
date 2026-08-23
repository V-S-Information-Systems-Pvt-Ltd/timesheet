// tests/migrate.test.ts
// Unit tests for the hardened migration runner (checksums, advisory locks, rollback).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeChecksum, runMigrations, MIGRATION_ADVISORY_LOCK_ID } from '../lib/db/migrate'

describe('migration runner hardening', () => {
  let mockClientQueries: Array<{ sql: string; params?: unknown[] }>
  let mockPool: { connect: ReturnType<typeof vi.fn> }
  let mockLockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }
  let mockWorkerClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockClientQueries = []

    mockLockClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        mockClientQueries.push({ sql, params })
        if (sql.includes('select name, checksum from public.schema_migrations')) {
          return { rows: [] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }

    mockWorkerClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        mockClientQueries.push({ sql, params })
        return { rows: [] }
      }),
      release: vi.fn(),
    }

    let clientIndex = 0
    mockPool = {
      connect: vi.fn(async () => {
        if (clientIndex === 0) {
          clientIndex++
          return mockLockClient
        }
        return mockWorkerClient
      }),
    }
  })

  it('computes sha256 checksums accurately', () => {
    const sum1 = computeChecksum('CREATE TABLE test (id int);')
    const sum2 = computeChecksum('CREATE TABLE test (id int);')
    const sum3 = computeChecksum('CREATE TABLE test (id text);')
    expect(sum1).toBe(sum2)
    expect(sum1).not.toBe(sum3)
    expect(sum1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('acquires and releases advisory lock during migration execution', async () => {
    const applied = await runMigrations(mockPool as unknown as Parameters<typeof runMigrations>[0])
    expect(mockLockClient.query).toHaveBeenCalledWith('select pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID])
    expect(mockLockClient.query).toHaveBeenCalledWith('select pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID])
    expect(mockLockClient.release).toHaveBeenCalled()
    expect(Array.isArray(applied)).toBe(true)
  })

  it('detects checksum mismatch for already applied migrations and throws', async () => {
    mockLockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('select name, checksum from public.schema_migrations')) {
        return {
          rows: [
            { name: '0001_initial_schema.sql', checksum: 'different_checksum_than_disk_file_000000000000000000000000' },
          ],
        }
      }
      return { rows: [] }
    })

    await expect(runMigrations(mockPool as unknown as Parameters<typeof runMigrations>[0])).rejects.toThrow(/checksum mismatch/i)
  })

  it('upgrades legacy unchecksummed records on subsequent runs', async () => {
    mockLockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('select name, checksum from public.schema_migrations')) {
        // Return existing applied row with null checksum
        return {
          rows: [
            { name: '0001_initial_schema.sql', checksum: null },
          ],
        }
      }
      return { rows: [] }
    })

    await runMigrations(mockPool as unknown as Parameters<typeof runMigrations>[0])
    expect(mockLockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('update public.schema_migrations set checksum = $1 where name = $2'),
      [expect.any(String), '0001_initial_schema.sql']
    )
  })
})

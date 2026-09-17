import { describe, expect, it, vi } from 'vitest'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { verifyE2EFixtures } from '../scripts/verify-e2e-fixtures.mjs'

interface MockProfileRow {
  id: string
  email: string
  is_active: boolean
  role: string
  password_hash?: string
}

interface MockQueryResult {
  rows: MockProfileRow[]
}

function runScrypt(password: string, salt: string, keylen: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = await runScrypt(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  })
  return `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`
}

// Mock pg.Pool
vi.mock('pg', () => {
  const queryMock = vi.fn()
  const endMock = vi.fn().mockResolvedValue(undefined)
  class Pool {
    query = queryMock
    end = endMock
  }
  return { default: { Pool }, Pool }
})

// Mock @supabase/supabase-js
const mockSignInWithPassword = vi.fn()
vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => ({
      auth: {
        signInWithPassword: mockSignInWithPassword,
      },
    })),
  }
})

describe('verifyE2EFixtures', () => {
  it('throws if DATABASE_URL or TEST_DATABASE_URL is missing', async () => {
    await expect(
      verifyE2EFixtures({
        env: {
          DATABASE_URL: '',
          TEST_DATABASE_URL: '',
        },
      })
    ).rejects.toThrow(/DATABASE_URL or TEST_DATABASE_URL is required/)
  })

  it('verifies native fixtures successfully when accounts and passwords match', async () => {
    const pg = await import('pg')
    const poolInstance = new pg.default.Pool()
    const validAdminHash = await hashPassword('AdminPassword123!')
    const validPendingHash = await hashPassword('MatrixPassword123!')

    vi.mocked(poolInstance.query).mockImplementation(async (_sql: unknown, params?: unknown): Promise<unknown> => {
      const email = ((params as string[] | undefined)?.[0] || '').toLowerCase()
      if (email === 'admin@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'admin-id',
              email: 'admin@vsis.lk',
              is_active: true,
              role: 'admin',
              password_hash: validAdminHash,
            },
          ],
        }
        return result
      }
      if (email === 'deactivated@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'pending-id',
              email: 'deactivated@vsis.lk',
              is_active: false,
              role: 'user',
              password_hash: validPendingHash,
            },
          ],
        }
        return result
      }
      const emptyResult: MockQueryResult = { rows: [] }
      return emptyResult
    })

    const result = await verifyE2EFixtures({
      env: {
        NEXT_PUBLIC_BACKEND: 'native',
        DATABASE_URL: 'postgres://vsis:vsis@localhost:5432/vsis_test',
        E2E_EMAIL: 'admin@vsis.lk',
        E2E_PASSWORD: 'AdminPassword123!',
        E2E_PENDING_EMAIL: 'deactivated@vsis.lk',
        E2E_PENDING_PASSWORD: 'MatrixPassword123!',
      },
    })

    expect(result).toEqual({ success: true })
  })

  it('throws when a native fixture has an invalid password', async () => {
    const pg = await import('pg')
    const poolInstance = new pg.default.Pool()
    const wrongHash = await hashPassword('DifferentPassword!')

    vi.mocked(poolInstance.query).mockImplementation(async (_sql: unknown, params?: unknown): Promise<unknown> => {
      const email = ((params as string[] | undefined)?.[0] || '').toLowerCase()
      if (email === 'admin@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'admin-id',
              email: 'admin@vsis.lk',
              is_active: true,
              role: 'admin',
              password_hash: wrongHash,
            },
          ],
        }
        return result
      }
      const emptyResult: MockQueryResult = { rows: [] }
      return emptyResult
    })

    await expect(
      verifyE2EFixtures({
        env: {
          NEXT_PUBLIC_BACKEND: 'native',
          DATABASE_URL: 'postgres://vsis:vsis@localhost:5432/vsis_test',
          E2E_EMAIL: 'admin@vsis.lk',
          E2E_PASSWORD: 'AdminPassword123!',
          E2E_PENDING_EMAIL: 'deactivated@vsis.lk',
          E2E_PENDING_PASSWORD: 'MatrixPassword123!',
        },
      })
    ).rejects.toThrow(/Invalid password for native E2E fixture: admin@vsis.lk/)
  })

  it('throws when an account has unexpected status (e.g. pending instead of active)', async () => {
    const pg = await import('pg')
    const poolInstance = new pg.default.Pool()
    const validHash = await hashPassword('AdminPassword123!')

    vi.mocked(poolInstance.query).mockImplementation(async (_sql: unknown, params?: unknown): Promise<unknown> => {
      const email = ((params as string[] | undefined)?.[0] || '').toLowerCase()
      if (email === 'admin@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'admin-id',
              email: 'admin@vsis.lk',
              is_active: false, // Unexpectedly inactive!
              role: 'admin',
              password_hash: validHash,
            },
          ],
        }
        return result
      }
      const emptyResult: MockQueryResult = { rows: [] }
      return emptyResult
    })

    await expect(
      verifyE2EFixtures({
        env: {
          NEXT_PUBLIC_BACKEND: 'native',
          DATABASE_URL: 'postgres://vsis:vsis@localhost:5432/vsis_test',
          E2E_EMAIL: 'admin@vsis.lk',
          E2E_PASSWORD: 'AdminPassword123!',
          E2E_PENDING_EMAIL: 'deactivated@vsis.lk',
          E2E_PENDING_PASSWORD: 'MatrixPassword123!',
        },
      })
    ).rejects.toThrow(/Unexpected status for admin@vsis.lk: expected active/)
  })

  it('throws when an E2E fixture is missing from the database', async () => {
    const pg = await import('pg')
    const poolInstance = new pg.default.Pool()

    const emptyResult: MockQueryResult = { rows: [] }
    vi.mocked(poolInstance.query).mockResolvedValue(emptyResult as unknown as never)

    await expect(
      verifyE2EFixtures({
        env: {
          NEXT_PUBLIC_BACKEND: 'native',
          DATABASE_URL: 'postgres://vsis:vsis@localhost:5432/vsis_test',
          E2E_EMAIL: 'missing@vsis.lk',
          E2E_PASSWORD: 'AdminPassword123!',
          E2E_PENDING_EMAIL: 'deactivated@vsis.lk',
          E2E_PENDING_PASSWORD: 'MatrixPassword123!',
        },
      })
    ).rejects.toThrow(/Missing E2E fixture profile in database: missing@vsis.lk/)
  })

  it('verifies supabase fixtures successfully when profiles exist and signInWithPassword succeeds', async () => {
    const pg = await import('pg')
    const poolInstance = new pg.default.Pool()

    vi.mocked(poolInstance.query).mockImplementation(async (_sql: unknown, params?: unknown): Promise<unknown> => {
      const email = ((params as string[] | undefined)?.[0] || '').toLowerCase()
      if (email === 'admin@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'supabase-admin-id',
              email: 'admin@vsis.lk',
              is_active: true,
              role: 'admin',
            },
          ],
        }
        return result
      }
      if (email === 'deactivated@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'supabase-pending-id',
              email: 'deactivated@vsis.lk',
              is_active: false,
              role: 'user',
            },
          ],
        }
        return result
      }
      const emptyResult: MockQueryResult = { rows: [] }
      return emptyResult
    })

    mockSignInWithPassword.mockResolvedValue({
      data: { session: { user: { id: 'mock-auth-id' } } },
      error: null,
    })

    const result = await verifyE2EFixtures({
      env: {
        NEXT_PUBLIC_BACKEND: 'supabase',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:54322/postgres',
        E2E_EMAIL: 'admin@vsis.lk',
        E2E_PASSWORD: 'AdminPassword123!',
        E2E_PENDING_EMAIL: 'deactivated@vsis.lk',
        E2E_PENDING_PASSWORD: 'MatrixPassword123!',
      },
    })

    expect(result).toEqual({ success: true })
    expect(mockSignInWithPassword).toHaveBeenCalledTimes(2)
  })

  it('throws when supabase auth signInWithPassword rejects credentials', async () => {
    const pg = await import('pg')
    const poolInstance = new pg.default.Pool()

    vi.mocked(poolInstance.query).mockImplementation(async (_sql: unknown, params?: unknown): Promise<unknown> => {
      const email = ((params as string[] | undefined)?.[0] || '').toLowerCase()
      if (email === 'admin@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'supabase-admin-id',
              email: 'admin@vsis.lk',
              is_active: true,
              role: 'admin',
            },
          ],
        }
        return result
      }
      if (email === 'deactivated@vsis.lk') {
        const result: MockQueryResult = {
          rows: [
            {
              id: 'supabase-pending-id',
              email: 'deactivated@vsis.lk',
              is_active: false,
              role: 'user',
            },
          ],
        }
        return result
      }
      return { rows: [] }
    })

    mockSignInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Invalid login credentials' },
    })

    await expect(
      verifyE2EFixtures({
        env: {
          NEXT_PUBLIC_BACKEND: 'supabase',
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key',
          DATABASE_URL: 'postgres://postgres:postgres@localhost:54322/postgres',
          E2E_EMAIL: 'admin@vsis.lk',
          E2E_PASSWORD: 'WrongPassword!',
          E2E_PENDING_EMAIL: 'deactivated@vsis.lk',
          E2E_PENDING_PASSWORD: 'MatrixPassword123!',
        },
      })
    ).rejects.toThrow(/Invalid credentials for Supabase E2E fixture admin@vsis.lk: Invalid login credentials/)
  })
})

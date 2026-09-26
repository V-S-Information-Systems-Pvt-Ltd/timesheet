// tests/migration-identity-inventory.test.ts
// C04 identity inventory reads: sign-in provider aggregation and the
// missing `auth.mfa_factors` compatibility fallback. The fallback must not rely
// on catching the error, because these reads run inside the planning/export
// snapshot transaction, where a failed statement aborts every later query.

import { describe, expect, it } from 'vitest'
import { readIdentityInventory, type CanonicalReadPort } from '@vsis/migration-tool/providers/read'

function session(handler: (sql: string) => unknown[]) {
  const queries: string[] = []
  const port: CanonicalReadPort = {
    async query(sql: string) {
      queries.push(sql)
      return handler(sql) as never
    },
  }
  return { port, queries }
}

describe('C04 identity inventory', () => {
  it('reports zero second factors without querying a missing auth.mfa_factors relation', async () => {
    const { port, queries } = session((sql) => {
      if (sql.includes("to_regclass('auth.mfa_factors')")) return [{ present: false }]
      if (sql.includes('from auth.mfa_factors')) {
        throw Object.assign(new Error('relation "auth.mfa_factors" does not exist'), { code: '42P01' })
      }
      if (sql.includes('from auth.users')) {
        return [{ id: 'u1', email: 'a@example.com', email_confirmed: true, providers: ['email'] }]
      }
      return []
    })

    const records = await readIdentityInventory(port, 'supabase')

    expect(records).toEqual([
      {
        id: 'u1',
        email: 'a@example.com',
        emailConfirmed: true,
        hasCredential: null,
        providerIdentities: ['email'],
        mfaFactors: 0,
      },
    ])
    expect(queries.some((sql) => sql.includes('from auth.mfa_factors'))).toBe(false)
  })

  it('counts registered second factors when the relation exists', async () => {
    const { port } = session((sql) => {
      if (sql.includes("to_regclass('auth.mfa_factors')")) return [{ present: true }]
      if (sql.includes('from auth.mfa_factors')) return [{ user_id: 'u1', factors: '2' }]
      if (sql.includes('from auth.users')) {
        return [{ id: 'u1', email: 'a@example.com', email_confirmed: false, providers: ['google', 'email'] }]
      }
      return []
    })

    const records = await readIdentityInventory(port, 'supabase')

    expect(records[0].mfaFactors).toBe(2)
    expect(records[0].providerIdentities).toEqual(['email', 'google'])
    expect(records[0].emailConfirmed).toBe(false)
  })

  it('reads native profile credentials without provider or second-factor facts', async () => {
    const { port } = session((sql) => {
      if (sql.includes('has_password')) {
        return [{ id: 'u1', email: 'a@example.com', has_password: true }]
      }
      return []
    })

    const records = await readIdentityInventory(port, 'native')

    expect(records).toEqual([
      {
        id: 'u1',
        email: 'a@example.com',
        emailConfirmed: null,
        hasCredential: true,
        providerIdentities: null,
        mfaFactors: null,
      },
    ])
  })
})
// tools/migration/tests/migration-identity-inventory.test.ts

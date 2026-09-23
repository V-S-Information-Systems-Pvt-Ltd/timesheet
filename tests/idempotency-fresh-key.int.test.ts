import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { admitsFreshKey, issueFreshKeys } from '@/lib/idempotency-fresh-key'

const enabled = process.env.MIGRATION_TEST_SUPABASE_FRESH_KEY === '1'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

if (enabled) {
  if (process.env.NEXT_PUBLIC_BACKEND !== 'supabase' ||
      !url || !serviceKey || !anonKey ||
      !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) {
    throw new Error('Fresh-key live suite requires an explicit loopback Supabase stack and all local API keys.')
  }
}

const suite = enabled ? describe : describe.skip

suite('fresh mobile admission keys (local Supabase)', () => {
  it('issues an actor-bound key and denies public inspection', async () => {
    const actor = randomUUID()
    let key = ''
    try {
      const tickets = await issueFreshKeys(actor, 'create_reminder', 1)
      expect(tickets).toHaveLength(1)
      key = tickets![0].key
      expect(await admitsFreshKey(key, actor, 'create_reminder')).toBe(true)
      expect(await admitsFreshKey(key, randomUUID(), 'create_reminder')).toBe(false)
      expect(await admitsFreshKey(key, actor, 'create_leave')).toBe(false)

      const read = await fetch(`${url}/rest/v1/migration_fresh_keys?key=eq.${encodeURIComponent(key)}`, {
        headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
      })
      expect([401, 403]).toContain(read.status)
    } finally {
      if (key) {
        const deleted = await fetch(`${url}/rest/v1/migration_fresh_keys?key=eq.${encodeURIComponent(key)}`, {
          method: 'DELETE',
          headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
        })
        expect(deleted.ok).toBe(true)
      }
    }
  })
})

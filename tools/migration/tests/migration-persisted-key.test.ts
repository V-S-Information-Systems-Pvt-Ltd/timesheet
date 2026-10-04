import { describe, expect, it } from 'vitest'
import { PERSISTED_KEY_PREFIX, decodePersistedKey, encodePersistedKey } from '@vsis/migration-tool/persisted-key'
import { readDestinationProvenanceReceipts } from '@vsis/migration-tool/providers/read'

describe('PostgreSQL-safe migration metadata keys', () => {
  const uuid = '11111111-1111-4111-8111-111111111111'
  const compound = `${uuid}\u0000bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`

  it.each([uuid, '1', 'legacy text', ''])('preserves ordinary legacy key %j byte for byte', (key) => {
    expect(encodePersistedKey(key)).toBe(key)
    expect(decodePersistedKey(key)).toBe(key)
  })

  it.each([compound, '\u0000', 'a\u0000b\u0000c', `${PERSISTED_KEY_PREFIX}v2:literal`, `${PERSISTED_KEY_PREFIX}日本語\u0000😀`, `${PERSISTED_KEY_PREFIX}\ud800`])('round trips special keys without NUL bytes (%#)', (key) => {
    const stored = encodePersistedKey(key)
    expect(stored).not.toContain('\u0000')
    expect(stored).toMatch(/^~vsis-key:v1:[A-Za-z0-9_-]+$/)
    expect(decodePersistedKey(stored)).toBe(key)
  })

  it('is injective across the reserved prefix and separator-like strings', () => {
    const envelope = encodePersistedKey(compound)
    const keys = [compound, envelope, encodePersistedKey(envelope), 'a\u0000b', 'a|b', 'a\\0b', `${PERSISTED_KEY_PREFIX}`, `${PERSISTED_KEY_PREFIX}v1:`]
    const encoded = keys.map(encodePersistedKey)
    expect(new Set(encoded).size).toBe(keys.length)
    expect(encoded.map(decodePersistedKey)).toEqual(keys)
  })

  it.each([
    `${PERSISTED_KEY_PREFIX}v2:abc`, `${PERSISTED_KEY_PREFIX}v1:`, `${PERSISTED_KEY_PREFIX}v1:!!!!`,
    `${PERSISTED_KEY_PREFIX}v1:${Buffer.from(JSON.stringify(uuid)).toString('base64url')}`,
    `${PERSISTED_KEY_PREFIX}v1:${Buffer.from('123').toString('base64url')}`,
    `${PERSISTED_KEY_PREFIX}v1:${Buffer.from('"unterminated').toString('base64url')}`,
    `${encodePersistedKey(compound)}=`,
    `${PERSISTED_KEY_PREFIX}v1:${Buffer.from(` ${JSON.stringify(compound)}`).toString('base64url')}`,
    `${PERSISTED_KEY_PREFIX}v1:${Buffer.from([0x22, 0xff, 0x22]).toString('base64url')}`,
    'impossible\u0000stored',
  ])('rejects malformed or noncanonical stored envelopes (%#)', (stored) => {
    expect(() => decodePersistedKey(stored)).toThrow(expect.objectContaining({ code: 'E_PERSISTED_KEY_INVALID' }))
  })

  it('decodes both provenance directions and preserves ordinary UUID receipts', async () => {
    const rows = [
      { entity: 'global_reminder_dismissals', source_id: encodePersistedKey(compound), destination_id: encodePersistedKey(`other\u0000tuple`) },
      { entity: 'projects', source_id: uuid, destination_id: uuid },
    ].map((row) => ({ ...row, source_namespace: 'native:source', target_namespace: 'native:target', run_id: 'test-run', state: 'verified' }))
    const receipts = await readDestinationProvenanceReceipts({ query: async () => rows } as never, 'native:target')
    expect(receipts[0]).toMatchObject({ sourceId: compound, destinationId: 'other\u0000tuple' })
    expect(receipts[1]).toMatchObject({ sourceId: uuid, destinationId: uuid })
  })

  it('refuses malformed persisted provenance rather than admitting raw aliases', async () => {
    await expect(readDestinationProvenanceReceipts({ query: async () => [{
      entity: 'projects', source_id: uuid, destination_id: `${PERSISTED_KEY_PREFIX}v1:invalid`,
    }] } as never, 'native:target')).rejects.toMatchObject({ code: 'E_PERSISTED_KEY_INVALID' })
  })
})

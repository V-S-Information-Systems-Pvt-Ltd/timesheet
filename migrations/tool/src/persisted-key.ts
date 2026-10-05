// Only the PostgreSQL metadata boundary uses this representation. Canonical
// bundle/plan keys and ordinary UUID runtime mappings remain unchanged.
import { MigrationRunError } from './journal'

export const PERSISTED_KEY_PREFIX = '~vsis-key:'
const V1_PREFIX = `${PERSISTED_KEY_PREFIX}v1:`

export function encodePersistedKey(key: string): string {
  if (!key.includes('\u0000') && !key.startsWith(PERSISTED_KEY_PREFIX)) return key
  // JSON preserves every JS string, including escaped NUL and lone surrogates;
  // the envelope is ASCII and cannot acquire a PostgreSQL-invalid byte.
  return V1_PREFIX + Buffer.from(JSON.stringify(key), 'utf8').toString('base64url')
}

export function decodePersistedKey(stored: string): string {
  const invalid = () => new MigrationRunError('E_PERSISTED_KEY_INVALID', 'Invalid persisted migration key encoding.')
  if (stored.includes('\u0000')) throw invalid()
  if (!stored.startsWith(PERSISTED_KEY_PREFIX)) return stored
  if (!stored.startsWith(V1_PREFIX)) throw invalid()
  const payload = stored.slice(V1_PREFIX.length)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw invalid()
  let key: unknown
  try {
    key = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }
  // Strict re-encoding rejects permissive base64/UTF8 decoding, noncanonical
  // JSON and envelopes for ordinary keys. There is one stored form per key.
  if (typeof key !== 'string' || encodePersistedKey(key) !== stored) throw invalid()
  return key
}

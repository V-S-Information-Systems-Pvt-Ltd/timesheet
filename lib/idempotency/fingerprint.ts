import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** Stable request fingerprint independent of JSON object key ordering. */
export function computePayloadFingerprint(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload ?? {}))).digest('hex')
}

// tests/migration-format.test.ts
// C01 format/canonicalization contract: dependency order, lossless value
// handling (decimals, timestamps, JSON numeric literals, null vs empty string),
// digest stability and strict manifest schema.

import { describe, expect, it } from 'vitest'
import {
  CANONICALIZATION_VERSION,
  ENTITY_ORDER,
  ENTITY_SPECS,
  MIGRATION_FORMAT,
  MIGRATION_FORMAT_VERSION,
  MigrationFormatError,
  bundleDigestOf,
  canonicalRowLine,
  canonicalStringify,
  canonicalizeJsonText,
  canonicalizeRow,
  canonicalizeTimestampText,
  digestRows,
  manifestSchema,
  primaryKeyOf,
} from '@/lib/migration/format'
import { profileRow, timesheetRow, TS } from './helpers/migration-fixtures'

describe('migration entity matrix', () => {
  it('declares every dependency before its dependents', () => {
    const seen = new Set<string>()
    for (const entity of ENTITY_ORDER) {
      for (const dependency of ENTITY_SPECS[entity].dependsOn) {
        expect(seen.has(dependency), `${entity} depends on ${dependency}`).toBe(true)
      }
      seen.add(entity)
    }
    expect(seen.size).toBe(ENTITY_ORDER.length)
  })

  it('declares provider-internal entity names in the matrix', () => {
    expect(ENTITY_ORDER).toContain('profiles')
    expect(ENTITY_ORDER).toContain('timesheets')
    expect(ENTITY_ORDER).toContain('audit_logs')
  })
})

describe('canonical values', () => {
  it('keeps decimals and precise timestamps out of lossy JS numbers', () => {
    const row = canonicalizeRow('timesheets', timesheetRow())
    expect(row.hours_worked).toBe('7.50')
    expect(row.created_at).toBe('2026-09-02T16:30:00.123456Z')
    expect(canonicalRowLine('timesheets', timesheetRow())).toContain('"hours_worked":"7.50"')
  })

  it('rejects a decimal supplied as a JS number', () => {
    expect(() => canonicalizeRow('timesheets', timesheetRow({ hours_worked: 7.5 }))).toThrow(MigrationFormatError)
  })

  it('rejects non-canonical timestamps and non-canonical UUID case', () => {
    expect(() => canonicalizeRow('timesheets', timesheetRow({ created_at: '2026-09-02T16:30:00Z' }))).toThrow(
      /ffffffZ/
    )
    expect(() =>
      canonicalizeRow('profiles', profileRow({ id: 'AAAAAAAA-1111-4111-8111-111111111111' }))
    ).toThrow(/canonical UUID/)
  })

  it('keeps null distinct from an empty string', () => {
    const withNull = canonicalizeRow('projects', {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Support',
      so_number: null,
      telegram_no: null,
      created_at: '2026-09-01T08:00:00.000000Z',
    })
    const withEmpty = canonicalizeRow('projects', {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Support',
      so_number: '',
      telegram_no: null,
      created_at: '2026-09-01T08:00:00.000000Z',
    })
    expect(withNull.so_number).toBeNull()
    expect(withEmpty.so_number).toBe('')
    expect(canonicalStringify(withNull)).not.toBe(canonicalStringify(withEmpty))
  })

  it('rejects unknown and missing columns', () => {
    expect(() => canonicalizeRow('profiles', profileRow({ password_hash: 'x' }))).toThrow(/unknown column/)
    const missing = profileRow()
    delete missing.title
    expect(() => canonicalizeRow('profiles', missing)).toThrow(/missing column/)
  })

  it('requires json columns to be canonical text', () => {
    expect(() => canonicalizeRow('profiles', profileRow({ dashboard_layout: '{"b":1,"a":2}' }))).toThrow(
      /not canonical JSON/
    )
    const canonical = canonicalizeRow('profiles', profileRow({ dashboard_layout: '{"a":2,"b":1}' }))
    expect(canonical.dashboard_layout).toBe('{"a":2,"b":1}')
  })

  it('converts PostgreSQL timestamp text without losing microseconds', () => {
    expect(canonicalizeTimestampText('2026-09-19 10:00:00.12+00')).toBe('2026-09-19T10:00:00.120000Z')
    expect(canonicalizeTimestampText('2026-09-19 10:00:00+00')).toBe('2026-09-19T10:00:00.000000Z')
    expect(canonicalizeTimestampText('2026-09-19T10:00:00.123456Z')).toBe('2026-09-19T10:00:00.123456Z')
    expect(canonicalizeTimestampText('2026-09-19 10:00:00+05:30')).toBe('2026-09-19T04:30:00.000000Z')
    expect(canonicalizeTimestampText('2026-09-19 01:00:00.500000+05:30')).toBe('2026-09-18T19:30:00.500000Z')
    expect(canonicalizeTimestampText('2026-09-19 22:00:00.123456-04:00')).toBe('2026-09-20T02:00:00.123456Z')
    expect(canonicalizeTimestampText('2026-09-19 10:00:00-05')).toBe('2026-09-19T15:00:00.000000Z')
    expect(canonicalizeTimestampText('2026-09-19 10:00:00+0530')).toBe('2026-09-19T04:30:00.000000Z')
    expect(() => canonicalizeTimestampText('2026-02-29 10:00:00+00')).toThrow(MigrationFormatError)
    expect(() => canonicalizeTimestampText('2026-09-19 24:00:00+00')).toThrow(MigrationFormatError)
    expect(() => canonicalizeTimestampText('2026-09-19 10:00:00+24:00')).toThrow(MigrationFormatError)
    expect(() => canonicalizeTimestampText('not a timestamp')).toThrow(MigrationFormatError)
  })
})

describe('canonical JSON text', () => {
  it('sorts keys and preserves numeric literals verbatim', () => {
    expect(canonicalizeJsonText('{"b": 1.10, "a": [2, {"d": 4, "c": 3}]}')).toBe(
      '{"a":[2,{"c":3,"d":4}],"b":1.10}'
    )
  })

  it('preserves large integer literals that JSON.parse would round', () => {
    const canonical = canonicalizeJsonText('{"n": 123456789012345678901234567890}')
    expect(canonical).toBe('{"n":123456789012345678901234567890}')
  })

  it('rejects duplicate keys and trailing content', () => {
    expect(() => canonicalizeJsonText('{"a":1,"a":2}')).toThrow(/Duplicate object key/)
    expect(() => canonicalizeJsonText('{"a":1} trailing')).toThrow(/Trailing content/)
    expect(() => canonicalizeJsonText('')).toThrow(MigrationFormatError)
  })

  it('round-trips strings with escapes and unicode', () => {
    const text = '{"emoji":"\\u00e9\\ud83d\\ude00","quote":"a\\"b"}'
    expect(canonicalizeJsonText(text)).toBe('{"emoji":"é😀","quote":"a\\"b"}')
    expect(canonicalizeJsonText(canonicalizeJsonText(text))).toBe(canonicalizeJsonText(text))
  })
})

describe('canonicalStringify and digests', () => {
  it('sorts nested object keys so digests are input-order independent', () => {
    const a = canonicalStringify({ z: 1, a: { y: 2, b: 3 } })
    const b = canonicalStringify({ a: { b: 3, y: 2 }, z: 1 })
    expect(a).toBe(b)
  })

  it('digests rows independently of input key order', () => {
    const first = digestRows('profiles', [profileRow({ id: '11111111-1111-4111-8111-111111111111' })])
    const shuffled = profileRow({ id: '11111111-1111-4111-8111-111111111111' })
    const reordered: Record<string, unknown> = {}
    for (const key of Object.keys(shuffled).reverse()) reordered[key] = shuffled[key]
    expect(digestRows('profiles', [reordered])).toBe(first)
  })

  it('ties a bundle digest to exact manifest content', () => {
    const manifest = {
      format: MIGRATION_FORMAT as typeof MIGRATION_FORMAT,
      formatVersion: MIGRATION_FORMAT_VERSION as typeof MIGRATION_FORMAT_VERSION,
      canonicalizationVersion: CANONICALIZATION_VERSION as typeof CANONICALIZATION_VERSION,
      runId: 'r',
      bundleId: 'b',
      source: {
        provider: 'native' as const,
        namespace: 'n',
        applicationVersion: '1.0.3',
        schemaFingerprint: 'a'.repeat(64),
        appliedMigrations: [],
        releaseRevision: null,
      },
      exportedAt: TS('2026-09-19T00:00:00.000000Z'),
      snapshot: { mode: 'repeatable-read' as const, startedAt: TS('2026-09-19T00:00:00.000000Z'), transactionId: null },
      tool: { name: 'vsis-migration' as const, version: '1', applicationVersion: '1.0.3' },
      accountPolicy: { enrollment: 'destination-enrollment' as const, passwordTransfer: 'none' as const },
      entities: [],
      provenance: { file: 'provenance.json' as const, count: 0, byteSize: 0, sha256: 'b'.repeat(64) },
      exclusions: [],
      transformations: [],
    }
    const base = bundleDigestOf(manifest)
    expect(bundleDigestOf({ ...manifest, runId: 'r2' })).not.toBe(base)
    expect(bundleDigestOf({ ...manifest, exportedAt: TS('2026-09-19T00:00:01.000000Z') })).not.toBe(base)
  })

  it('keys composite primary keys stably', () => {
    const row = canonicalizeRow('global_reminder_dismissals', {
      user_id: '11111111-1111-4111-8111-111111111111',
      reminder_id: '44444444-4444-4444-8444-444444444444',
      dismissed_at: '2026-09-03T00:00:00.000000Z',
    })
    expect(primaryKeyOf('global_reminder_dismissals', row)).toBe(
      '11111111-1111-4111-8111-111111111111\u000044444444-4444-4444-8444-444444444444'
    )
  })
})

describe('manifest schema', () => {
  const validManifest = () => ({
    format: MIGRATION_FORMAT,
    formatVersion: MIGRATION_FORMAT_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    runId: 'r',
    bundleId: 'b',
    source: {
      provider: 'native',
      namespace: 'n',
      applicationVersion: '1.0.3',
      schemaFingerprint: 'a'.repeat(64),
      appliedMigrations: [],
      releaseRevision: null,
    },
    exportedAt: '2026-09-19T00:00:00.000000Z',
    snapshot: { mode: 'repeatable-read', startedAt: '2026-09-19T00:00:00.000000Z', transactionId: null },
    tool: { name: 'vsis-migration', version: '1', applicationVersion: '1.0.3' },
    accountPolicy: { enrollment: 'destination-enrollment', passwordTransfer: 'none' },
    entities: [],
    provenance: { file: 'provenance.json', count: 0, byteSize: 0, sha256: 'b'.repeat(64) },
    exclusions: [],
    transformations: [],
  })

  it('accepts a well-formed manifest', () => {
    expect(manifestSchema.safeParse(validManifest()).success).toBe(true)
  })

  it('fails closed on unknown fields, versions and digests', () => {
    expect(manifestSchema.safeParse({ ...validManifest(), extra: true }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...validManifest(), formatVersion: 2 }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...validManifest(), canonicalizationVersion: 99 }).success).toBe(false)
    const badDigest = validManifest()
    badDigest.source.schemaFingerprint = 'not-a-digest'
    expect(manifestSchema.safeParse(badDigest).success).toBe(false)
    const badProvenance = validManifest()
    badProvenance.provenance.file = 'other.json'
    expect(manifestSchema.safeParse(badProvenance).success).toBe(false)
  })
})

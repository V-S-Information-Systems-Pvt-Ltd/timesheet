// migrations/tool/src/format.ts
// Versioned migration-bundle format, entity allowlist and the canonical value
// contract shared by export, planning and import.
//
// This module is pure: it imports no database client, no Next.js request-bound
// module, no application pool and no secret. The operator CLI is its only
// caller inside this repository; ordinary application/browser code must not
// import it (enforced by tests/boundary-enforcement.test.ts).
//
// Canonical representations (lossless, provider-neutral):
//   uuid          lowercase 8-4-4-4-12 UUID string
//   text          exact UTF-8 string; no trimming or normalization; null != ''
//   boolean       true | false
//   date          'YYYY-MM-DD'
//   timestamptz   'YYYY-MM-DDTHH:MM:SS.ffffffZ' (always UTC, always 6 fraction digits)
//   decimal       exact decimal text, e.g. '7.50' (never a JS number)
//   integer       JS safe integer (no bigint columns exist in this schema)
//   json          canonical JSON *text* with object keys sorted and numeric
//                 literals preserved verbatim

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ENTRY_TYPES, ACTIVITY_CODES, refineClassification } from '@vsis/contracts'

export const MIGRATION_FORMAT = 'vsis-data-migration'
export const MIGRATION_FORMAT_VERSION = 2
export const CANONICALIZATION_VERSION = 1
export const MANIFEST_FILE = 'manifest.json'
export const PROVENANCE_FILE = 'provenance.json'
export const IDENTITIES_FILE = 'identities.json'
export const RETRY_HISTORY_FILE = 'retry-history.json'

export const PROVIDER_NAMES = ['native', 'supabase'] as const
export type ProviderName = (typeof PROVIDER_NAMES)[number]

export type CanonicalValueKind =
  | 'uuid'
  | 'text'
  | 'boolean'
  | 'date'
  | 'timestamptz'
  | 'decimal'
  | 'integer'
  | 'json'

export type MigrationEntity =
  | 'titles'
  | 'whitelisted_domains'
  | 'projects'
  | 'activity_types'
  | 'app_settings'
  | 'profiles'
  | 'global_reminders'
  | 'timesheets'
  | 'leaves'
  | 'reminders'
  | 'global_reminder_dismissals'
  | 'audit_logs'

export interface ColumnSpec {
  readonly name: string
  readonly kind: CanonicalValueKind
  readonly nullable: boolean
  readonly references?: { readonly entity: MigrationEntity; readonly column: string }
}

export interface EntitySpec {
  readonly name: MigrationEntity
  readonly file: string
  readonly primaryKey: readonly string[]
  readonly columns: readonly ColumnSpec[]
  readonly dependsOn: readonly MigrationEntity[]
}

const column = (
  name: string,
  kind: CanonicalValueKind,
  nullable = false,
  references?: { entity: MigrationEntity; column: string }
): ColumnSpec => (references ? { name, kind, nullable, references } : { name, kind, nullable })

// Dependency order is declared once below; ENTITY_ORDER is derived from it so a
// new entity cannot be added without its dependencies.
export const ENTITY_SPECS: Record<MigrationEntity, EntitySpec> = {
  titles: {
    name: 'titles',
    file: 'titles.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('name', 'text'),
      column('hierarchy_role', 'text'),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: [],
  },
  whitelisted_domains: {
    name: 'whitelisted_domains',
    file: 'whitelisted_domains.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('domain', 'text'),
      column('auto_activate', 'boolean'),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: [],
  },
  projects: {
    name: 'projects',
    file: 'projects.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('name', 'text'),
      column('so_number', 'text', true),
      column('telegram_no', 'integer', true),
      column('is_timesheet_project', 'boolean'),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: [],
  },
  activity_types: {
    name: 'activity_types',
    file: 'activity_types.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('name', 'text'),
      column('is_active', 'boolean'),
      column('telegram_no', 'integer', true),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: [],
  },
  app_settings: {
    name: 'app_settings',
    file: 'app_settings.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'integer'),
      column('backfill_window_days', 'integer'),
      column('backfill_mode', 'text'),
      column('backfill_extra_days', 'integer'),
      column('default_dashboard_layout', 'json', true),
      column('default_admin_layout', 'json', true),
      column('default_mobile_layout', 'json', true),
      column('app_name', 'text'),
      column('primary_color', 'text'),
      column('logo_url', 'text', true),
      column('updated_at', 'timestamptz'),
    ],
    dependsOn: [],
  },
  profiles: {
    name: 'profiles',
    file: 'profiles.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('email', 'text'),
      column('name', 'text'),
      column('department', 'text'),
      column('title', 'text'),
      column('permission_role', 'text'),
      column('hierarchy_role', 'text'),
      column('is_active', 'boolean'),
      column('manager_id', 'uuid', true, { entity: 'profiles', column: 'id' }),
      column('dashboard_layout', 'json', true),
      column('admin_layout', 'json', true),
      column('mobile_layout', 'json', true),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: [],
  },
  global_reminders: {
    name: 'global_reminders',
    file: 'global_reminders.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('message', 'text'),
      column('remind_at', 'timestamptz'),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: [],
  },
  timesheets: {
    name: 'timesheets',
    file: 'timesheets.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('user_id', 'uuid', false, { entity: 'profiles', column: 'id' }),
      column('project_id', 'uuid', true, { entity: 'projects', column: 'id' }),
      column('activity_type_id', 'uuid', true, { entity: 'activity_types', column: 'id' }),
      column('entry_type', 'text', true),
      column('activity_code', 'text', true),
      column('activity_other', 'text', true),
      column('ticket_number', 'text', true),
      column('log_date', 'date'),
      column('hours_worked', 'decimal'),
      column('work_done', 'text'),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: ['profiles', 'projects', 'activity_types'],
  },
  leaves: {
    name: 'leaves',
    file: 'leaves.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('user_id', 'uuid', false, { entity: 'profiles', column: 'id' }),
      column('leave_date', 'date'),
      column('reason', 'text'),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: ['profiles'],
  },
  reminders: {
    name: 'reminders',
    file: 'reminders.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('user_id', 'uuid', false, { entity: 'profiles', column: 'id' }),
      column('message', 'text'),
      column('remind_at', 'timestamptz'),
      column('done', 'boolean'),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: ['profiles'],
  },
  global_reminder_dismissals: {
    name: 'global_reminder_dismissals',
    file: 'global_reminder_dismissals.jsonl',
    primaryKey: ['user_id', 'reminder_id'],
    columns: [
      column('user_id', 'uuid', false, { entity: 'profiles', column: 'id' }),
      column('reminder_id', 'uuid', false, { entity: 'global_reminders', column: 'id' }),
      column('dismissed_at', 'timestamptz'),
    ],
    dependsOn: ['profiles', 'global_reminders'],
  },
  audit_logs: {
    name: 'audit_logs',
    file: 'audit_logs.jsonl',
    primaryKey: ['id'],
    columns: [
      column('id', 'uuid'),
      column('actor_id', 'uuid', true, { entity: 'profiles', column: 'id' }),
      column('actor_email', 'text'),
      column('action', 'text'),
      column('target_id', 'text', true),
      column('detail', 'json', true),
      column('created_at', 'timestamptz'),
    ],
    dependsOn: ['profiles'],
  },
}

export const ENTITY_NAMES = Object.keys(ENTITY_SPECS) as MigrationEntity[]

/** Dependency-correct export/import order (deterministic: declared order). */
export const ENTITY_ORDER: readonly MigrationEntity[] = ENTITY_NAMES

/** Exact v1 surface, retained only to validate old bytes and their fingerprints. */
export const LEGACY_ENTITY_SPECS = Object.fromEntries(Object.entries(ENTITY_SPECS).map(([entity, spec]) => [entity, {
  ...spec,
  columns: spec.columns.filter(c => !['is_timesheet_project', 'entry_type', 'activity_code', 'activity_other', 'ticket_number'].includes(c.name))
    .map(c => entity === 'timesheets' && c.name === 'project_id' ? { ...c, nullable: false } : c),
}])) as unknown as Record<MigrationEntity, EntitySpec>

export function entitySpec(entity: MigrationEntity, version: 1 | 2 = MIGRATION_FORMAT_VERSION): EntitySpec {
  return (version === 1 ? LEGACY_ENTITY_SPECS : ENTITY_SPECS)[entity]
}

export const BUNDLE_DETAIL_FIELDS = ['entry_type', 'activity_code', 'activity_other', 'ticket_number'] as const

/** Shared branch rules without work/date limits (existing bundles can hold any duration). */
const bundleClassificationSchema = z.object({
  entryType: z.enum(ENTRY_TYPES),
  activityCode: z.enum(ACTIVITY_CODES),
  projectId: z.string().nullable(),
  activityOther: z.string().nullable(),
  ticketNumber: z.string().nullable(),
}).superRefine((v, ctx) => refineClassification(v, ctx))

/** Explicit legacy adapter; never infer a row classification from project names. */
export function adaptLegacyRow(entity: MigrationEntity, row: CanonicalRow): CanonicalRow {
  if (entity === 'timesheets') return { ...row, entry_type: null, activity_code: null, activity_other: null, ticket_number: null }
  if (entity === 'projects') return { ...row, is_timesheet_project: !['internal', 'internal it', 'support'].includes(String(row.name).trim().toLowerCase()) }
  return row
}

/** Classification belongs in merge review, not importer-side coercion. */
export function validateClassificationRow(entity: MigrationEntity, row: CanonicalRow): void {
  if (entity !== 'timesheets') return
  if (row.entry_type === null) {
    if (row.project_id === null || BUNDLE_DETAIL_FIELDS.slice(1).some(key => row[key] !== null)) {
      throw new MigrationFormatError('E_CLASSIFICATION', 'Legacy timesheet has invalid classification fields.')
    }
    return
  }
  const parsed = bundleClassificationSchema.safeParse({ entryType: row.entry_type, activityCode: row.activity_code,
    projectId: row.project_id, activityOther: row.activity_other, ticketNumber: row.ticket_number })
  if (!parsed.success || row.activity_type_id !== null) {
    throw new MigrationFormatError('E_CLASSIFICATION', `Invalid timesheet classification: ${parsed.success ? 'legacy reference' : parsed.error.issues[0].message}.`)
  }
}

export function entityColumns(entity: MigrationEntity): string[] {
  return ENTITY_SPECS[entity].columns.map((c) => c.name)
}

export function isMigrationEntity(value: string): value is MigrationEntity {
  return Object.prototype.hasOwnProperty.call(ENTITY_SPECS, value)
}

export const ENTITY_FILES = ENTITY_NAMES.map((name) => ENTITY_SPECS[name].file)

export const BUNDLE_FILES: readonly string[] = [
  MANIFEST_FILE,
  PROVENANCE_FILE,
  IDENTITIES_FILE,
  RETRY_HISTORY_FILE,
  ...ENTITY_FILES,
]

/** Hard bounds applied before any content is trusted. */
export const BUNDLE_LIMITS = {
  manifestBytes: 4 * 1024 * 1024,
  provenanceBytes: 64 * 1024 * 1024,
  identitiesBytes: 64 * 1024 * 1024,
  retryHistoryBytes: 64 * 1024 * 1024,
  entityFileBytes: 8 * 1024 * 1024 * 1024,
  rowBytes: 4 * 1024 * 1024,
} as const

export class MigrationFormatError extends Error {
  readonly code: string
  readonly path: string | null

  constructor(code: string, message: string, path?: string) {
    super(message)
    this.name = 'MigrationFormatError'
    this.code = code
    this.path = path ?? null
  }
}

/** The bundle's UUID contract: shape only, any variant/version nibble. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/
const DECIMAL_RE = /^-?\d+(\.\d+)?$/

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

/**
 * A regex match is not a calendar date. `2026-02-31` and `25:00:00` must fail
 * here, while the bundle is still being validated, instead of surviving
 * export/validation and failing later during a database cast.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  // The canonical four-digit representation follows PostgreSQL's ordinary
  // AD date range. Year zero is not a PostgreSQL calendar date, and allowing
  // it would also trigger Date's legacy 1900-based handling in some paths.
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false
  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : DAYS_PER_MONTH[month - 1]
  return day <= daysInMonth
}

function isRealCalendarTime(hour: number, minute: number, second: number): boolean {
  return hour <= 23 && minute <= 59 && second <= 59
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Stable JSON serialization: object keys sorted recursively, no whitespace. */
export function canonicalStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MigrationFormatError(
        'E_VALUE_INVALID',
        `Non-finite number is not canonical (${String(value)}).`
      )
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item === undefined ? null : item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalStringify(v)}`)
      .join(',')}}`
  }
  throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported canonical value type: ${typeof value}`)
}

// --- JSON text canonicalization -------------------------------------------
// PostgreSQL jsonb text output normalizes key order and whitespace, but a
// parsed-then-restringified value would lose numeric literals (JSON.parse
// converts them to double precision). This parser keeps every number literal
// verbatim while sorting object keys, so canonical JSON text is byte-stable and
// lossless for jsonb values.

type JsonNode =
  | { kind: 'null' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; literal: string }
  | { kind: 'string'; value: string }
  | { kind: 'array'; items: JsonNode[] }
  | { kind: 'object'; entries: Array<[string, JsonNode]> }

class JsonTextParser {
  private position = 0

  constructor(private readonly text: string) {}

  parse(): JsonNode {
    this.skipWhitespace()
    const node = this.parseValue()
    this.skipWhitespace()
    if (this.position !== this.text.length) {
      throw new MigrationFormatError('E_JSON_INVALID', 'Trailing content after JSON value.')
    }
    return node
  }

  private skipWhitespace(): void {
    while (this.position < this.text.length && /\s/.test(this.text[this.position])) this.position += 1
  }

  private parseValue(): JsonNode {
    const ch = this.text[this.position]
    if (ch === undefined) throw new MigrationFormatError('E_JSON_INVALID', 'Unexpected end of JSON text.')
    if (ch === '{') return this.parseObject()
    if (ch === '[') return this.parseArray()
    if (ch === '"') return { kind: 'string', value: this.parseString() }
    if (ch === 't' || ch === 'f') return this.parseBoolean()
    if (ch === 'n') return this.parseNull()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber()
    throw new MigrationFormatError('E_JSON_INVALID', `Unexpected character '${ch}' in JSON text.`)
  }

  private parseObject(): JsonNode {
    this.position += 1
    const entries: Array<[string, JsonNode]> = []
    const seen = new Set<string>()
    this.skipWhitespace()
    if (this.text[this.position] === '}') {
      this.position += 1
      return { kind: 'object', entries }
    }
    for (;;) {
      this.skipWhitespace()
      if (this.text[this.position] !== '"') {
        throw new MigrationFormatError('E_JSON_INVALID', 'Object key must be a string.')
      }
      const key = this.parseString()
      if (seen.has(key)) {
        throw new MigrationFormatError('E_JSON_INVALID', `Duplicate object key "${key}" is not canonical.`)
      }
      seen.add(key)
      this.skipWhitespace()
      if (this.text[this.position] !== ':') {
        throw new MigrationFormatError('E_JSON_INVALID', 'Missing ":" after object key.')
      }
      this.position += 1
      this.skipWhitespace()
      entries.push([key, this.parseValue()])
      this.skipWhitespace()
      const next = this.text[this.position]
      if (next === ',') {
        this.position += 1
        continue
      }
      if (next === '}') {
        this.position += 1
        return { kind: 'object', entries }
      }
      throw new MigrationFormatError('E_JSON_INVALID', 'Expected "," or "}" in object.')
    }
  }

  private parseArray(): JsonNode {
    this.position += 1
    const items: JsonNode[] = []
    this.skipWhitespace()
    if (this.text[this.position] === ']') {
      this.position += 1
      return { kind: 'array', items }
    }
    for (;;) {
      this.skipWhitespace()
      items.push(this.parseValue())
      this.skipWhitespace()
      const next = this.text[this.position]
      if (next === ',') {
        this.position += 1
        continue
      }
      if (next === ']') {
        this.position += 1
        return { kind: 'array', items }
      }
      throw new MigrationFormatError('E_JSON_INVALID', 'Expected "," or "]" in array.')
    }
  }

  private parseString(): string {
    const start = this.position
    this.position += 1
    for (;;) {
      const ch = this.text[this.position]
      if (ch === undefined) throw new MigrationFormatError('E_JSON_INVALID', 'Unterminated JSON string.')
      if (ch === '"') {
        this.position += 1
        const raw = this.text.slice(start, this.position)
        try {
          return JSON.parse(raw) as string
        } catch {
          throw new MigrationFormatError('E_JSON_INVALID', 'Invalid JSON string escape.')
        }
      }
      if (ch === '\\') {
        this.position += 2
        continue
      }
      if (ch.charCodeAt(0) < 0x20) {
        throw new MigrationFormatError('E_JSON_INVALID', 'Raw control character in JSON string.')
      }
      this.position += 1
    }
  }

  private parseBoolean(): JsonNode {
    if (this.text.startsWith('true', this.position)) {
      this.position += 4
      return { kind: 'boolean', value: true }
    }
    if (this.text.startsWith('false', this.position)) {
      this.position += 5
      return { kind: 'boolean', value: false }
    }
    throw new MigrationFormatError('E_JSON_INVALID', 'Invalid JSON literal.')
  }

  private parseNull(): JsonNode {
    if (this.text.startsWith('null', this.position)) {
      this.position += 4
      return { kind: 'null' }
    }
    throw new MigrationFormatError('E_JSON_INVALID', 'Invalid JSON literal.')
  }

  private parseNumber(): JsonNode {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.position))
    if (!match) throw new MigrationFormatError('E_JSON_INVALID', 'Invalid JSON number.')
    this.position += match[0].length
    return { kind: 'number', literal: match[0] }
  }
}

function serializeJsonNode(node: JsonNode): string {
  switch (node.kind) {
    case 'null':
      return 'null'
    case 'boolean':
      return node.value ? 'true' : 'false'
    case 'number':
      return node.literal
    case 'string':
      return JSON.stringify(node.value)
    case 'array':
      return `[${node.items.map(serializeJsonNode).join(',')}]`
    case 'object':
      return `{${[...node.entries]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${JSON.stringify(key)}:${serializeJsonNode(value)}`)
        .join(',')}}`
  }
}

/** Canonicalize JSON text: sorted keys, no whitespace, numeric literals preserved. */
export function canonicalizeJsonText(text: string): string {
  return serializeJsonNode(new JsonTextParser(text).parse())
}

// --- Row canonicalization ---------------------------------------------------

export interface CanonicalRow {
  [column: string]: string | number | boolean | null
}

function checkValue(
  entity: MigrationEntity,
  spec: ColumnSpec,
  value: unknown
): string | number | boolean | null {
  const where = `${entity}.${spec.name}`
  if (value === null) {
    if (!spec.nullable) {
      throw new MigrationFormatError('E_VALUE_NULL', `Non-nullable column ${where} is null.`)
    }
    return null
  }
  switch (spec.kind) {
    case 'uuid': {
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        throw new MigrationFormatError('E_VALUE_INVALID', `Column ${where} is not a canonical UUID.`)
      }
      return value
    }
    case 'text': {
      if (typeof value !== 'string') {
        throw new MigrationFormatError('E_VALUE_INVALID', `Column ${where} must be a string.`)
      }
      return value
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new MigrationFormatError('E_VALUE_INVALID', `Column ${where} must be a boolean.`)
      }
      return value
    }
    case 'date': {
      if (typeof value !== 'string') {
        throw new MigrationFormatError('E_VALUE_INVALID', `Column ${where} must be a real YYYY-MM-DD date.`)
      }
      const match = DATE_RE.exec(value)
      if (!match || !isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
        throw new MigrationFormatError('E_VALUE_INVALID', `Column ${where} must be a real YYYY-MM-DD date.`)
      }
      return value
    }
    case 'timestamptz': {
      if (typeof value !== 'string') {
        throw new MigrationFormatError(
          'E_VALUE_INVALID',
          `Column ${where} must be a real YYYY-MM-DDTHH:MM:SS.ffffffZ timestamp.`
        )
      }
      const match = TIMESTAMP_RE.exec(value)
      if (
        !match ||
        !isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])) ||
        !isRealCalendarTime(Number(match[4]), Number(match[5]), Number(match[6]))
      ) {
        throw new MigrationFormatError(
          'E_VALUE_INVALID',
          `Column ${where} must be a real YYYY-MM-DDTHH:MM:SS.ffffffZ timestamp.`
        )
      }
      return value
    }
    case 'decimal': {
      if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
        throw new MigrationFormatError(
          'E_VALUE_INVALID',
          `Column ${where} must be exact decimal text (never a JS number).`
        )
      }
      return value
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new MigrationFormatError('E_VALUE_INVALID', `Column ${where} must be a safe integer.`)
      }
      return value
    }
    case 'json': {
      if (typeof value !== 'string') {
        throw new MigrationFormatError('E_VALUE_INVALID', `Column ${where} must be canonical JSON text.`)
      }
      const canonical = canonicalizeJsonText(value)
      if (canonical !== value) {
        throw new MigrationFormatError(
          'E_NON_CANONICAL_JSON',
          `Column ${where} is not canonical JSON text (expected byte-stable sorted keys).`
        )
      }
      return value
    }
  }
}

/** Validate and normalize one entity row against its declared column allowlist. */
export function canonicalizeRow(entity: MigrationEntity, input: unknown, version: 1 | 2 = MIGRATION_FORMAT_VERSION): CanonicalRow {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new MigrationFormatError('E_ROW_SCHEMA', `${entity} row must be a JSON object.`)
  }
  const spec = entitySpec(entity, version)
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!spec.columns.some((c) => c.name === key)) {
      throw new MigrationFormatError('E_COLUMN_UNKNOWN', `${entity} row has unknown column "${key}".`)
    }
  }
  const out: CanonicalRow = {}
  for (const columnSpec of spec.columns) {
    if (!Object.prototype.hasOwnProperty.call(record, columnSpec.name)) {
      throw new MigrationFormatError(
        'E_COLUMN_MISSING',
        `${entity} row is missing column "${columnSpec.name}".`
      )
    }
    out[columnSpec.name] = checkValue(entity, columnSpec, record[columnSpec.name])
  }
  if (version === 2) validateClassificationRow(entity, out)
  return out
}

/** Canonical JSONL line for one entity row (no trailing newline). */
export function canonicalRowLine(entity: MigrationEntity, input: unknown, version: 1 | 2 = MIGRATION_FORMAT_VERSION): string {
  return canonicalStringify(canonicalizeRow(entity, input, version))
}

export function primaryKeyOf(entity: MigrationEntity, row: CanonicalRow): string {
  return entitySpec(entity)
    .primaryKey.map((key) => String(row[key]))
    .join('\u0000')
}

/** Digest over the canonical row sequence of one entity file. */
export function digestRows(entity: MigrationEntity, rows: unknown[]): string {
  const hash = createHash('sha256')
  for (const row of rows) hash.update(canonicalRowLine(entity, row)).update('\n')
  return hash.digest('hex')
}

export function canonicalizeTimestampText(pgText: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:([+-]\d{2})(?::?(\d{2}))?|[Zz])?$/.exec(
    pgText.trim()
  )
  if (!match) {
    throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported timestamp text "${pgText}".`)
  }
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const day = parseInt(match[3], 10)
  const hour = parseInt(match[4], 10)
  const minute = parseInt(match[5], 10)
  const second = parseInt(match[6], 10)
  const micros = (match[7] ?? '0').padEnd(6, '0')

  // Date.UTC normalizes out-of-range fields instead of rejecting them. Check
  // the wall-clock components first so malformed provider text cannot silently
  // turn into a different instant.
  if (
    !isRealCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported timestamp text "${pgText}".`)
  }
  const wallClock = new Date(0)
  wallClock.setUTCFullYear(year, month - 1, day)
  wallClock.setUTCHours(hour, minute, second, 0)
  if (
    !Number.isFinite(wallClock.getTime()) ||
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day ||
    wallClock.getUTCHours() !== hour ||
    wallClock.getUTCMinutes() !== minute ||
    wallClock.getUTCSeconds() !== second
  ) {
    throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported timestamp text "${pgText}".`)
  }

  let totalOffsetMinutes = 0
  if (match[8]) {
    const sign = match[8].startsWith('-') ? -1 : 1
    const offHours = parseInt(match[8].slice(1), 10)
    const offMinutes = match[9] ? parseInt(match[9], 10) : 0
    if (offHours > 23 || offMinutes > 59) {
      throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported timestamp text "${pgText}".`)
    }
    totalOffsetMinutes = sign * (offHours * 60 + offMinutes)
  }

  const epochMs = wallClock.getTime() - totalOffsetMinutes * 60 * 1000
  if (!Number.isFinite(epochMs)) {
    throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported timestamp text "${pgText}".`)
  }
  const d = new Date(epochMs)
  if (!Number.isFinite(d.getTime())) {
    throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported timestamp text "${pgText}".`)
  }
  const y = d.getUTCFullYear()
  if (y < 1 || y > 9999) {
    throw new MigrationFormatError('E_VALUE_INVALID', `Unsupported timestamp text "${pgText}".`)
  }
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dayStr = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${String(y).padStart(4, '0')}-${m}-${dayStr}T${h}:${min}:${s}.${micros}Z`
}

// --- Manifest schema --------------------------------------------------------

export const sourceInstanceSchema = z.strictObject({
  provider: z.enum(PROVIDER_NAMES),
  /** Stable verified instance fingerprint; never a raw connection string. */
  namespace: z.string().min(1),
  /**
   * Server-fact runtime fingerprint recorded at export time. It is independent
   * of the connecting role, so `plan` can detect a same-instance source/target
   * even when one connection could read the privileged system identifier and
   * the other could not. Absent in bundles written before it was recorded.
   */
  runtimeFingerprint: z.string().min(1).optional(),
  applicationVersion: z.string().min(1),
  schemaFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  appliedMigrations: z.array(z.string().min(1)),
  releaseRevision: z.string().min(1).nullable(),
})

export const manifestEntitySchema = z.strictObject({
  entity: z.string().min(1),
  file: z.string().min(1),
  primaryKey: z.array(z.string().min(1)).min(1),
  columns: z.array(z.string().min(1)).min(1),
  rowCount: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

export const manifestSchema = z.strictObject({
  format: z.literal(MIGRATION_FORMAT),
  formatVersion: z.union([z.literal(1), z.literal(MIGRATION_FORMAT_VERSION)]),
  canonicalizationVersion: z.literal(CANONICALIZATION_VERSION),
  runId: z.string().min(1),
  bundleId: z.string().min(1),
  source: sourceInstanceSchema,
  exportedAt: z.string().regex(TIMESTAMP_RE),
  snapshot: z.strictObject({
    mode: z.enum(['repeatable-read', 'read-only-transaction']),
    startedAt: z.string().regex(TIMESTAMP_RE),
    transactionId: z.string().min(1).nullable(),
  }),
  tool: z.strictObject({
    name: z.literal('vsis-migration'),
    version: z.string().min(1),
    applicationVersion: z.string().min(1),
  }),
  accountPolicy: z.strictObject({
    enrollment: z.literal('destination-enrollment'),
    passwordTransfer: z.literal('none'),
  }),
  entities: z.array(manifestEntitySchema),
  provenance: z.strictObject({
    file: z.literal(PROVENANCE_FILE),
    count: z.number().int().nonnegative(),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  /**
   * Source account assurance facts. Optional so bundles written before source
   * identity capture stay readable; an apply against a bundle without them
   * fails closed rather than assuming every account is a password account.
   */
  identities: z
    .strictObject({
      file: z.literal(IDENTITIES_FILE),
      count: z.number().int().nonnegative(),
      byteSize: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .optional(),
  retryHistory: z
    .strictObject({
      file: z.literal(RETRY_HISTORY_FILE),
      count: z.number().int().nonnegative(),
      byteSize: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .optional(),
  exclusions: z.array(z.strictObject({ category: z.string().min(1), reason: z.string().min(1) })),
  transformations: z.array(
    z.strictObject({
      entity: z.string().min(1),
      column: z.string().min(1),
      kind: z.string().min(1),
      detail: z.string().min(1),
    })
  ),
})

export type BundleManifest = z.infer<typeof manifestSchema>
export type ManifestEntityFile = z.infer<typeof manifestEntitySchema>
export type SourceInstanceDescriptor = z.infer<typeof sourceInstanceSchema>

export const provenanceAliasSchema = z.strictObject({
  entity: z.string().min(1),
  sourceId: z.string().min(1),
  destinationId: z.string().min(1),
  /** Namespace of the deployment the destination id belongs to. */
  instanceNamespace: z.string().min(1),
  recordedAt: z.string().regex(TIMESTAMP_RE),
})

export const provenanceSchema = z.strictObject({
  format: z.literal(MIGRATION_FORMAT),
  formatVersion: z.union([z.literal(1), z.literal(MIGRATION_FORMAT_VERSION)]),
  aliases: z.array(provenanceAliasSchema),
})

export type ProvenanceAlias = z.infer<typeof provenanceAliasSchema>
export type ProvenanceFile = z.infer<typeof provenanceSchema>

/**
 * One source account's assurance facts. They are captured at export time so a
 * review can see an OAuth sign-in or a registered second factor before an
 * account is re-created as a weaker password identity. Nothing here is applied
 * to the destination; it only informs the reviewed disposition.
 */
export const identityFactSchema = z.strictObject({
  id: z.string().min(1),
  email: z.string().nullable(),
  /** Supabase: inbox-verified fact. Native: null (no verification concept). */
  emailConfirmed: z.boolean().nullable(),
  /** Native: a usable local credential exists. Supabase: null (provider-managed). */
  hasCredential: z.boolean().nullable(),
  /** Supabase sign-in providers for this account; native: null. */
  providerIdentities: z.array(z.string()).nullable(),
  /** Registered second factors; native: null. */
  mfaFactors: z.number().int().nonnegative().nullable(),
})

export const identitiesFileSchema = z.strictObject({
  format: z.literal(MIGRATION_FORMAT),
  formatVersion: z.union([z.literal(1), z.literal(MIGRATION_FORMAT_VERSION)]),
  // One record per account: duplicates would let a weaker second record replace
  // the original assurance facts in any consumer that indexes by id.
  identities: z.array(identityFactSchema).superRefine((items, ctx) => {
    const seen = new Set<string>()
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate account id ${item.id}`,
        })
      }
      seen.add(item.id)
    }
  }),
})

export type IdentityFact = z.infer<typeof identityFactSchema>
export type IdentitiesFile = z.infer<typeof identitiesFileSchema>

export const retryHistoryFactSchema = z.strictObject({
  sourceNamespace: z.string().min(1),
  key: z.string().min(1),
  sourceActorId: z.string().min(1),
  operation: z.enum([
    'create_timesheet', 'update_timesheet', 'delete_timesheet',
    'create_leave', 'delete_leave',
    'create_reminder', 'update_reminder', 'delete_reminder',
  ]),
  outcome: z.enum(['committed', 'uncertain']),
  responseStatus: z.number().int().nonnegative(),
  fingerprintKind: z.enum(['request-json-v1', 'effect-v1']),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  sourceResourceId: z.string().nullable(),
  createdAt: z.string().regex(TIMESTAMP_RE),
}).superRefine((fact, ctx) => {
  if (fact.outcome === 'committed' && (fact.responseStatus <= 0 || fact.fingerprint === null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'committed retry history requires a positive responseStatus and fingerprint',
    })
  }
  if (fact.outcome === 'uncertain' && fact.responseStatus > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'uncertain retry history cannot carry a positive responseStatus',
    })
  }
})

export const retryHistoryFileSchema = z.strictObject({
  format: z.literal(MIGRATION_FORMAT),
  formatVersion: z.union([z.literal(1), z.literal(MIGRATION_FORMAT_VERSION)]),
  records: z.array(retryHistoryFactSchema).superRefine((items, ctx) => {
    const seen = new Set<string>()
    for (const [index, item] of items.entries()) {
      const key = `${item.sourceNamespace}\u0000${item.key}\u0000${item.sourceActorId}\u0000${item.operation}`
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: [index], message: 'duplicate namespaced idempotency history record' })
      }
      seen.add(key)
    }
  }),
})

export type RetryHistoryFact = z.infer<typeof retryHistoryFactSchema>
export type RetryHistoryFile = z.infer<typeof retryHistoryFileSchema>

/** Digest that binds a merge plan to the exact reviewed bundle. */
export function bundleDigestOf(manifest: BundleManifest): string {
  return sha256Hex(canonicalStringify(manifest))
}

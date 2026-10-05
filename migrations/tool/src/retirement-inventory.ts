import { z } from 'zod'
import {
  MigrationFormatError,
  PROVIDER_NAMES,
  canonicalStringify,
  sha256Hex,
  type ProviderName,
} from './format'
import { MigrationRunError } from './journal'
import type { DatabaseSession } from './providers/session'

export const RETIREMENT_DECLARATION_FORMAT = 'vsis-retirement-inventory-declaration'
export const RETIREMENT_EVIDENCE_FORMAT = 'vsis-retirement-inventory-evidence'
export const RETIREMENT_FORMAT_VERSION = 1

const token = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/)
const known = z.enum(['enabled', 'disabled', 'unknown'])
const yesNoUnknown = z.enum(['yes', 'no', 'unknown'])
const clientInventoryState = z.enum(['complete', 'partial', 'unknown'])

const clientSchema = z.object({
  family: z.enum(['browser', 'mobile', 'api', 'integration']),
  version: token.or(z.literal('unknown')),
  environment: z.enum(['production', 'development', 'test', 'unknown']),
  support: z.enum(['supported', 'unsupported', 'unknown']),
  transport: z.enum([
    'cookie-v1',
    'bearer-v1',
    'legacy-http',
    'server-action',
    'provider-sdk',
    'unknown',
  ]),
  queuedWrites: yesNoUnknown,
  consumesFreshTickets: yesNoUnknown,
}).strict()

export const retirementDeclarationSchema = z.object({
  format: z.literal(RETIREMENT_DECLARATION_FORMAT),
  formatVersion: z.literal(RETIREMENT_FORMAT_VERSION),
  deployment: z.object({
    label: token,
    environment: token,
    provider: z.enum(PROVIDER_NAMES),
    applicationRelease: token.or(z.literal('unknown')),
    expectedNamespace: token.or(z.literal('unknown')),
  }).strict(),
  provenance: z.object({
    declaredAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
    evidenceRef: token,
    toolRevision: token.or(z.literal('unknown')),
    toolDirtyState: z.enum(['clean', 'dirty', 'unknown']),
  }).strict(),
  capabilities: z.object({
    backendSelection: z.enum([...PROVIDER_NAMES, 'unknown']),
    durableIdempotency: known,
    mobileBearerAuth: known,
    portableRetry: known,
    freshTicketIssuance: known,
  }).strict(),
  clientInventory: z.object({
    state: clientInventoryState,
    noKnownClients: z.boolean(),
    clients: z.array(clientSchema).max(100),
  }).strict(),
  queueConsumers: z.object({
    status: z.enum(['known', 'none', 'unknown']),
    policy: z.enum([
      'preserve-through-supported-window',
      'coordinated-upgrade',
      'manual-review',
      'none',
      'unknown',
    ]),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.clientInventory.clients.length === 0 && !value.clientInventory.noKnownClients) {
    context.addIssue({
      code: 'custom',
      path: ['clientInventory', 'noKnownClients'],
      message: 'An empty client list requires noKnownClients=true.',
    })
  }
  if (value.clientInventory.clients.length > 0 && value.clientInventory.noKnownClients) {
    context.addIssue({
      code: 'custom',
      path: ['clientInventory', 'noKnownClients'],
      message: 'noKnownClients cannot be true when clients are declared.',
    })
  }
  if (value.capabilities.backendSelection !== 'unknown' &&
      value.capabilities.backendSelection !== value.deployment.provider) {
    context.addIssue({
      code: 'custom',
      path: ['capabilities', 'backendSelection'],
      message: 'backendSelection must match the declared deployment provider.',
    })
  }
  if (Date.parse(value.provenance.validUntil) <= Date.parse(value.provenance.declaredAt)) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'validUntil'],
      message: 'validUntil must be later than declaredAt.',
    })
  }
})

export type RetirementDeclaration = z.infer<typeof retirementDeclarationSchema>

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  migration_runs: ['state', 'source_namespace', 'committed_at'],
  migration_record_map: ['source_namespace', 'entity', 'run_id'],
  migration_record_dispositions: ['entity', 'action'],
  migration_retry_history: ['operation', 'outcome', 'created_at'],
  migration_fresh_keys: ['operation', 'fence_generation', 'issued_at', 'expires_at'],
  migration_write_gate: ['id', 'state', 'fence_generation', 'updated_at'],
}

const RUN_STATES = new Set(['data-committed', 'verified', 'publication-intent', 'writable', 'failed'])
const ENTITIES = new Set(['profiles', 'projects', 'activity_types', 'timesheets', 'leaves', 'reminders', 'global_reminders', 'app_settings'])
const DISPOSITION_ACTIONS = new Set(['create', 'update', 'map', 'exclude'])
const RETRY_OPERATIONS = new Set([
  'create_timesheet', 'update_timesheet', 'delete_timesheet',
  'create_leave', 'delete_leave',
  'create_reminder', 'update_reminder', 'delete_reminder',
])
const RETRY_OUTCOMES = new Set(['committed', 'uncertain'])
const FRESH_OPERATIONS = new Set(['create_reminder', 'create_leave'])
const TICKET_BUCKETS = new Set(['expired', 'current-generation-unexpired', 'other-generation-unexpired'])

export function parseRetirementDeclaration(value: unknown): RetirementDeclaration {
  const parsed = retirementDeclarationSchema.safeParse(value)
  if (!parsed.success) {
    throw new MigrationFormatError(
      'E_RETIREMENT_DECLARATION_INVALID',
      'Retirement inventory declaration is invalid.'
    )
  }
  return parsed.data
}

function safeCount(value: unknown, label: string): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new MigrationRunError(
      'E_RETIREMENT_EVIDENCE_BLOCKED',
      `Aggregate count for ${label} is invalid or exceeds the safe integer range.`
    )
  }
  return count
}

function timestamp(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  const millis = Date.parse(String(value))
  if (!Number.isFinite(millis)) {
    throw new MigrationRunError('E_RETIREMENT_EVIDENCE_BLOCKED', `Timestamp for ${label} is invalid.`)
  }
  return new Date(millis).toISOString()
}

function allowlisted(value: unknown, allowed: Set<string>, label: string): string {
  const text = String(value)
  if (!allowed.has(text)) {
    throw new MigrationRunError(
      'E_RETIREMENT_EVIDENCE_INCOMPATIBLE',
      `Observed an unsupported ${label} value.`
    )
  }
  return text
}

function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return values.sort((left, right) => key(left).localeCompare(key(right)))
}

function declarationUnresolved(declaration: RetirementDeclaration, snapshotAt: string): string[] {
  const unresolved = new Set<string>()
  if (declaration.deployment.applicationRelease === 'unknown') unresolved.add('DECLARED_RELEASE_UNKNOWN')
  if (declaration.deployment.expectedNamespace === 'unknown') unresolved.add('EXPECTED_NAMESPACE_UNKNOWN')
  if (declaration.provenance.toolRevision === 'unknown') unresolved.add('TOOL_REVISION_UNKNOWN')
  if (declaration.provenance.toolDirtyState === 'unknown') unresolved.add('TOOL_DIRTY_STATE_UNKNOWN')
  if (declaration.provenance.toolDirtyState === 'dirty') unresolved.add('TOOL_WORKTREE_DIRTY')
  if (Date.parse(declaration.provenance.declaredAt) > Date.parse(snapshotAt)) unresolved.add('DECLARATION_FROM_FUTURE')
  if (Date.parse(declaration.provenance.validUntil) <= Date.parse(snapshotAt)) unresolved.add('DECLARATION_STALE')
  for (const [name, value] of Object.entries(declaration.capabilities)) {
    if (value === 'unknown') unresolved.add(`CAPABILITY_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}_UNKNOWN`)
  }
  if (declaration.clientInventory.state !== 'complete') unresolved.add('CLIENT_INVENTORY_INCOMPLETE')
  for (const client of declaration.clientInventory.clients) {
    if (Object.values(client).includes('unknown')) unresolved.add('CLIENT_DECLARATION_UNKNOWN')
  }
  if (declaration.queueConsumers.status === 'unknown') unresolved.add('QUEUE_CONSUMERS_UNKNOWN')
  if (declaration.queueConsumers.policy === 'unknown') unresolved.add('QUEUE_POLICY_UNKNOWN')
  if (declaration.queueConsumers.status === 'none' && declaration.queueConsumers.policy !== 'none') {
    unresolved.add('QUEUE_POLICY_CONTRADICTS_STATUS')
  }
  if (declaration.queueConsumers.status !== 'none' && declaration.queueConsumers.policy === 'none') {
    unresolved.add('QUEUE_POLICY_CONTRADICTS_STATUS')
  }
  return [...unresolved].sort()
}

export interface RetirementEvidenceResult {
  artifact: Record<string, unknown>
  blocked: boolean
}

export async function captureRetirementEvidence(
  session: DatabaseSession,
  provider: ProviderName,
  declaration: RetirementDeclaration,
  startedAt: Date,
  completedAt: () => Date
): Promise<RetirementEvidenceResult> {
  if (declaration.deployment.provider !== provider) {
    throw new MigrationFormatError(
      'E_RETIREMENT_PROVIDER_MISMATCH',
      'Declaration provider does not match the requested database provider.'
    )
  }

  const body = await session.withReadOnlyTransaction(async () => {
    const identity = await session.identity()
    if (identity.provider !== provider) {
      throw new MigrationRunError('E_RETIREMENT_IDENTITY_MISMATCH', 'Observed database provider does not match the requested provider.')
    }
    if (declaration.deployment.expectedNamespace !== 'unknown' &&
        declaration.deployment.expectedNamespace !== identity.namespace) {
      throw new MigrationRunError('E_RETIREMENT_IDENTITY_MISMATCH', 'Observed database namespace does not match the declaration.')
    }

    const relationNames = Object.keys(REQUIRED_COLUMNS)
    const relationRows = await session.query<{
      relation: string
      row_security: boolean
      force_row_security: boolean
      owns_table: boolean
      role_superuser: boolean
      role_bypass_rls: boolean
    }>(
      `select /* retirement-inventory:visibility */
         c.relname as relation,
         c.relrowsecurity as row_security,
         c.relforcerowsecurity as force_row_security,
         c.relowner = role.oid as owns_table,
         role.rolsuper as role_superuser,
         role.rolbypassrls as role_bypass_rls
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       join pg_catalog.pg_roles role on role.rolname = current_user
       where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1::text[])
       order by c.relname`,
      [relationNames]
    )
    const observedRelations = new Map(relationRows.map((row) => [row.relation, row]))
    for (const relation of relationNames) {
      const row = observedRelations.get(relation)
      if (!row) {
        throw new MigrationRunError('E_RETIREMENT_EVIDENCE_BLOCKED', 'A required retirement evidence relation is missing.')
      }
      const bypassesRls = row.role_superuser || row.role_bypass_rls || (row.owns_table && !row.force_row_security)
      if (row.row_security && !bypassesRls) {
        throw new MigrationRunError('E_RETIREMENT_VISIBILITY_UNVERIFIED', 'The database role cannot prove complete retirement evidence visibility.')
      }
    }

    const columnRows = await session.query<{ relation: string; column_name: string }>(
      `select /* retirement-inventory:columns */ table_name as relation, column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = any($1::text[])
       order by table_name, ordinal_position`,
      [relationNames]
    )
    const columns = new Map<string, Set<string>>()
    for (const row of columnRows) {
      const set = columns.get(row.relation) ?? new Set<string>()
      set.add(row.column_name)
      columns.set(row.relation, set)
    }
    for (const [relation, required] of Object.entries(REQUIRED_COLUMNS)) {
      if (required.some((column) => !columns.get(relation)?.has(column))) {
        throw new MigrationRunError('E_RETIREMENT_EVIDENCE_INCOMPATIBLE', 'A required retirement evidence column is missing.')
      }
    }

    const [clock] = await session.query<{ snapshot_at: string }>(
      'select /* retirement-inventory:clock */ transaction_timestamp()::text as snapshot_at'
    )
    const snapshotAt = timestamp(clock?.snapshot_at, 'snapshot clock')
    if (!snapshotAt) throw new MigrationRunError('E_RETIREMENT_EVIDENCE_BLOCKED', 'Snapshot timestamp is unavailable.')

    const gateRows = await session.query<{
      state: string
      generation_present: boolean
      updated_at: string
      row_count: string
    }>(
      `select /* retirement-inventory:gate */
         min(state) as state,
         bool_and(fence_generation is not null) as generation_present,
         max(updated_at)::text as updated_at,
         count(*)::text as row_count
       from public.migration_write_gate`
    )
    const gate = gateRows[0]
    if (safeCount(gate?.row_count, 'write gate rows') !== 1 || !gate?.generation_present) {
      throw new MigrationRunError('E_RETIREMENT_EVIDENCE_BLOCKED', 'The durable write gate is missing or invalid.')
    }
    const gateState = allowlisted(gate.state, new Set(['open', 'fenced']), 'write-gate state')

    const runRows = await session.query<{ state: string; count: string; earliest: string | null; latest: string | null }>(
      `select /* retirement-inventory:runs */ state, count(*)::text as count,
         min(committed_at)::text as earliest, max(committed_at)::text as latest
       from public.migration_runs group by state order by state`
    )
    const runs = runRows.map((row) => ({
      state: allowlisted(row.state, RUN_STATES, 'migration run state'),
      count: safeCount(row.count, 'migration runs'),
      earliestCommittedAt: timestamp(row.earliest, 'migration run earliest'),
      latestCommittedAt: timestamp(row.latest, 'migration run latest'),
    }))

    const mappingRows = await session.query<{ entity: string; count: string }>(
      `select /* retirement-inventory:mappings */ entity, count(*)::text as count
       from public.migration_record_map group by entity order by entity`
    )
    const [mappingSummary] = await session.query<{ namespace_count: string; missing_run_links: string }>(
      `select /* retirement-inventory:mapping-summary */
         count(distinct m.source_namespace)::text as namespace_count,
         count(*) filter (where r.run_id is null)::text as missing_run_links
       from public.migration_record_map m
       left join public.migration_runs r on r.run_id = m.run_id`
    )
    const mappings = mappingRows.map((row) => ({
      entity: allowlisted(row.entity, ENTITIES, 'mapping entity'),
      count: safeCount(row.count, 'record mappings'),
    }))

    const dispositionRows = await session.query<{ entity: string; action: string; count: string }>(
      `select /* retirement-inventory:dispositions */ entity, action, count(*)::text as count
       from public.migration_record_dispositions group by entity, action order by entity, action`
    )
    const dispositions = dispositionRows.map((row) => ({
      entity: allowlisted(row.entity, ENTITIES, 'disposition entity'),
      action: allowlisted(row.action, DISPOSITION_ACTIONS, 'disposition action'),
      count: safeCount(row.count, 'record dispositions'),
    }))

    const retryRows = await session.query<{
      operation: string
      outcome: string
      count: string
      earliest: string | null
      latest: string | null
    }>(
      `select /* retirement-inventory:retry-history */ operation, outcome, count(*)::text as count,
         min(created_at)::text as earliest, max(created_at)::text as latest
       from public.migration_retry_history group by operation, outcome order by operation, outcome`
    )
    const retryHistory = retryRows.map((row) => ({
      operation: allowlisted(row.operation, RETRY_OPERATIONS, 'retry operation'),
      outcome: allowlisted(row.outcome, RETRY_OUTCOMES, 'retry outcome'),
      count: safeCount(row.count, 'retry history'),
      earliestCreatedAt: timestamp(row.earliest, 'retry history earliest'),
      latestCreatedAt: timestamp(row.latest, 'retry history latest'),
    }))

    const ticketRows = await session.query<{
      operation: string
      bucket: string
      count: string
      earliest_issued: string | null
      latest_expiry: string | null
    }>(
      `select /* retirement-inventory:fresh-tickets */ ticket.operation,
         case
           when ticket.expires_at <= transaction_timestamp() then 'expired'
           when gate.state = 'open' and ticket.fence_generation = gate.fence_generation then 'current-generation-unexpired'
           else 'other-generation-unexpired'
         end as bucket,
         count(*)::text as count,
         min(ticket.issued_at)::text as earliest_issued,
         max(ticket.expires_at)::text as latest_expiry
       from public.migration_fresh_keys ticket
       cross join public.migration_write_gate gate
       where gate.id
       group by ticket.operation, bucket
       order by ticket.operation, bucket`
    )
    const retainedIssuedTickets = ticketRows.map((row) => ({
      operation: allowlisted(row.operation, FRESH_OPERATIONS, 'fresh-ticket operation'),
      bucket: allowlisted(row.bucket, TICKET_BUCKETS, 'fresh-ticket bucket'),
      count: safeCount(row.count, 'retained issued tickets'),
      earliestIssuedAt: timestamp(row.earliest_issued, 'fresh-ticket earliest issuance'),
      latestExpiresAt: timestamp(row.latest_expiry, 'fresh-ticket latest expiry'),
    }))

    const migrations = await session.migrationLedger()
    const unresolved = declarationUnresolved(declaration, snapshotAt)
    if (safeCount(mappingSummary?.missing_run_links, 'mapping missing run links') > 0) {
      unresolved.push('MAPPING_RUN_LINK_MISSING')
      unresolved.sort()
    }
    const declarationDigest = sha256Hex(canonicalStringify(declaration))
    const completed = completedAt().toISOString()

    return {
      format: RETIREMENT_EVIDENCE_FORMAT,
      formatVersion: RETIREMENT_FORMAT_VERSION,
      canonicalizationVersion: 1,
      purpose: 'evidence-only',
      gateAssessment: 'not-performed',
      capture: {
        startedAt: startedAt.toISOString(),
        snapshotAt,
        completedAt: completed,
      },
      declaration: { value: declaration, digest: declarationDigest },
      database: {
        provider,
        namespace: identity.namespace,
        identityBinding: declaration.deployment.expectedNamespace === 'unknown' ? 'unbound' : 'matched',
        appliedMigrations: {
          count: migrations.length,
          digest: sha256Hex(canonicalStringify([...migrations].sort())),
          identifiers: [...migrations].sort(),
        },
        evidenceVisibility: 'complete',
      },
      observations: {
        writeGate: {
          state: gateState,
          generationPresent: true,
          updatedAt: timestamp(gate.updated_at, 'write gate update'),
        },
        migrationRuns: sorted(runs, (row) => row.state),
        mappings: {
          byEntity: sorted(mappings, (row) => row.entity),
          sourceNamespaceCount: safeCount(mappingSummary?.namespace_count, 'mapping namespaces'),
          missingRunLinkCount: safeCount(mappingSummary?.missing_run_links, 'mapping missing run links'),
        },
        dispositions: sorted(dispositions, (row) => `${row.entity}:${row.action}`),
        retryHistory: sorted(retryHistory, (row) => `${row.operation}:${row.outcome}`),
        retainedIssuedTickets: sorted(retainedIssuedTickets, (row) => `${row.operation}:${row.bucket}`),
      },
      unresolved,
      limitations: [
        'Capture success is evidence collection only and does not satisfy R1, R2, R3, C08, C09, or C10.',
        'Retained issued-ticket counts do not prove pending work, ticket consumption, offline queues, or future issuance.',
        'This snapshot becomes historical immediately and does not prove traffic or writer absence before or after capture.',
      ],
    }
  })

  const artifactDigest = sha256Hex(canonicalStringify(body))
  const artifact = { ...body, artifactDigest }
  return {
    artifact,
    blocked: (body.unresolved as string[]).length > 0,
  }
}

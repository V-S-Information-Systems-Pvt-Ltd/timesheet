import 'server-only'
import { IS_NATIVE } from '@/lib/backend/config'
import { query } from '@/lib/db/pool'
import { admitsFreshKey } from '@/lib/idempotency-fresh-key'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'
import { computePayloadFingerprint } from './fingerprint'
import { getAdminClient } from '@/lib/supabase/admin'

interface PortableRetryRow {
  source_namespace: string
  source_actor_id: string
  outcome: 'committed' | 'uncertain'
  response_status: number
  fingerprint_kind: 'request-json-v1' | 'effect-v1'
  fingerprint: string | null
}

interface PortableMapRow {
  entity: string
  source_id: string
  destination_id: string
}

export type PortableLocalState = 'none' | 'match' | 'conflict' | 'in_flight' | 'uncertain'

export interface PortableRetryDependencies {
  localState: (
    key: string,
    actorId: string,
    operation: string,
    payload: unknown
  ) => Promise<PortableLocalState>
  computeEffectFingerprint: (operation: string, payload: unknown) => Promise<string>
  reauthorize: (stored: { responseStatus: number }) => Promise<Response | null>
}

const PORTABLE_OPERATIONS = new Set([
  'create_timesheet', 'update_timesheet', 'delete_timesheet',
  'create_leave', 'delete_leave',
  'create_reminder', 'update_reminder', 'delete_reminder',
])

async function readPortableRetryRows(
  key: string,
  actorId: string,
  operation: string
): Promise<PortableRetryRow[]> {
  if (IS_NATIVE) {
    return query<PortableRetryRow>(
      `select source_namespace, source_actor_id, outcome, response_status,
              fingerprint_kind, fingerprint
         from public.migration_retry_history
        where key = $1 and destination_actor_id = $2 and operation = $3
        order by source_namespace, source_actor_id`,
      [key, actorId, operation]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => Promise<{
              data: PortableRetryRow[] | null
              error: { message?: string } | null
            }>
          }
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_retry_history')
    .select('source_namespace, source_actor_id, outcome, response_status, fingerprint_kind, fingerprint')
    .eq('key', key)
    .eq('destination_actor_id', actorId)
    .eq('operation', operation)
  if (error) throw new Error(`Portable idempotency history lookup failed: ${error.message}`)
  return Array.isArray(data) ? data : []
}

export function portablePayloadIds(operation: string, payload: unknown): Array<{ entity: string; id: string }> {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
  const found: Array<{ entity: string; id: string }> = []
  const add = (entity: string, value: unknown) => {
    if (typeof value === 'string' && value.length > 0) found.push({ entity, id: value })
  }
  if (operation === 'create_timesheet' || operation === 'update_timesheet') {
    add('profiles', p.userId)
    add('projects', p.projectId)
    add('activity_types', p.activityTypeId)
  }
  if (operation === 'update_timesheet' || operation === 'delete_timesheet') add('timesheets', p.id)
  if (operation === 'delete_leave') add('leaves', p.id)
  if (operation === 'update_reminder' || operation === 'delete_reminder') add('reminders', p.id)
  if (operation === 'create_leave') {
    const rows = Array.isArray(p.rows) ? p.rows : Array.isArray(payload) ? payload : []
    for (const row of rows) {
      if (row && typeof row === 'object') add('profiles', (row as Record<string, unknown>).userId)
    }
  }
  return found
}

async function readPortableSourceActors(
  actorId: string
): Promise<Array<{ source_namespace: string; source_id: string }>> {
  if (IS_NATIVE) {
    return query(
      `select source_namespace, source_id
         from public.migration_record_map
        where entity = 'profiles' and destination_id = $1
        order by source_namespace`,
      [actorId]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => Promise<{
            data: Array<{ source_namespace: string; source_id: string }> | null
            error: { message?: string } | null
          }>
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_record_map')
    .select('source_namespace, source_id')
    .eq('entity', 'profiles')
    .eq('destination_id', actorId)
  if (error) throw new Error(`Portable actor mapping lookup failed: ${error.message}`)
  return Array.isArray(data) ? data : []
}

async function readForwardPortableMappings(
  sourceNamespace: string,
  wanted: Array<{ entity: string; id: string }>
): Promise<PortableMapRow[]> {
  const ids = [...new Set(wanted.map((item) => item.id))]
  if (ids.length === 0) return []
  if (IS_NATIVE) {
    return query<PortableMapRow>(
      `select entity, source_id, destination_id
         from public.migration_record_map
        where source_namespace = $1 and source_id = any($2::text[])`,
      [sourceNamespace, ids]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          in: (column: string, values: string[]) => Promise<{
            data: PortableMapRow[] | null
            error: { message?: string } | null
          }>
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_record_map')
    .select('entity, source_id, destination_id')
    .eq('source_namespace', sourceNamespace)
    .in('source_id', ids)
  if (error) throw new Error(`Portable source mapping lookup failed: ${error.message}`)
  return data ?? []
}

export type PortablePayloadOutcome = 'destination-era' | 'translate' | 'review'

export interface PortablePayloadDecision {
  outcome: PortablePayloadOutcome
  translation: Record<string, string>
  reason?: string
  unresolved?: boolean
}

/** Decide whether an unrecorded queued payload is destination-era, translatable, or ambiguous. */
export function decidePortablePayload(
  wanted: Array<{ entity: string; id: string }>,
  forwardRows: PortableMapRow[],
  reverseRows: PortableMapRow[],
  namespaceCount: number
): PortablePayloadDecision {
  if (namespaceCount > 1) {
    return { outcome: 'review', translation: {}, reason: 'the actor is mapped from more than one deployment' }
  }
  if (wanted.length === 0) return { outcome: 'destination-era', translation: {}, unresolved: true }

  const forward = new Map(forwardRows.map((row) => [`${row.entity}:${row.source_id}`, row.destination_id]))
  const isDestinationOfRemapped = new Set(
    reverseRows.filter((row) => row.source_id !== row.destination_id).map((row) => `${row.entity}:${row.destination_id}`)
  )
  const knownDestinationIds = new Set(reverseRows.map((row) => `${row.entity}:${row.destination_id}`))

  const translation: Record<string, string> = {}
  const distinct = new Set(wanted.map((item) => `${item.entity}:${item.id}`))
  for (const item of wanted) {
    const key = `${item.entity}:${item.id}`
    const destination = forward.get(key)
    if (destination === undefined || destination === item.id) continue
    if (isDestinationOfRemapped.has(key)) {
      return { outcome: 'review', translation: {}, reason: `id ${item.id} exists on both sides of the mapping` }
    }
    translation[key] = destination
  }

  const remapped = Object.keys(translation)
  if (remapped.length === 0) {
    const unresolved = !wanted.every(
      (item) => forward.has(`${item.entity}:${item.id}`) || knownDestinationIds.has(`${item.entity}:${item.id}`)
    )
    return { outcome: 'destination-era', translation: {}, unresolved }
  }
  if (remapped.length !== distinct.size) {
    return {
      outcome: 'review',
      translation: {},
      reason: 'the payload mixes source-era and destination-era identifiers',
    }
  }
  return { outcome: 'translate', translation }
}

/** Rewrite only the identifiers represented in a reviewed translation. */
export function applyPortableTranslation(
  operation: string,
  payload: unknown,
  translation: Record<string, string>
): void {
  const replace = (target: Record<string, unknown>, entity: string, field: string) => {
    const value = target[field]
    if (typeof value !== 'string') return
    const destination = translation[`${entity}:${value}`]
    if (destination) target[field] = destination
  }
  const root = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null
  if (!root) return
  if (operation === 'create_timesheet' || operation === 'update_timesheet') {
    replace(root, 'profiles', 'userId')
    replace(root, 'projects', 'projectId')
    replace(root, 'activity_types', 'activityTypeId')
  }
  if (operation === 'update_timesheet' || operation === 'delete_timesheet') replace(root, 'timesheets', 'id')
  if (operation === 'delete_leave') replace(root, 'leaves', 'id')
  if (operation === 'update_reminder' || operation === 'delete_reminder') replace(root, 'reminders', 'id')
  if (operation === 'create_leave') {
    const rows = Array.isArray(root.rows) ? root.rows : Array.isArray(payload) ? payload as unknown[] : []
    for (const row of rows) {
      if (row && typeof row === 'object') replace(row as Record<string, unknown>, 'profiles', 'userId')
    }
  }
}

async function readPortableMappings(
  sourceNamespace: string,
  wanted: Array<{ entity: string; id: string }>
): Promise<PortableMapRow[]> {
  const ids = [...new Set(wanted.map((item) => item.id))]
  if (ids.length === 0) return []
  if (IS_NATIVE) {
    return query<PortableMapRow>(
      `select entity, source_id, destination_id
         from public.migration_record_map
        where source_namespace = $1 and destination_id = any($2::text[])`,
      [sourceNamespace, ids]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          in: (column: string, values: string[]) => Promise<{
            data: PortableMapRow[] | null
            error: { message?: string } | null
          }>
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_record_map')
    .select('entity, source_id, destination_id')
    .eq('source_namespace', sourceNamespace)
    .in('destination_id', ids)
  if (error) throw new Error(`Portable idempotency mapping lookup failed: ${error.message}`)
  return data ?? []
}

async function classifyPortablePayload(
  actorId: string,
  operation: string,
  payload: unknown
): Promise<PortablePayloadDecision & { actorRemapped: boolean }> {
  const actors = await readPortableSourceActors(actorId)
  if (actors.length === 0) {
    return { outcome: 'destination-era', translation: {}, actorRemapped: false }
  }
  const wanted = portablePayloadIds(operation, payload)
  if (wanted.length === 0) {
    return { outcome: 'destination-era', translation: {}, unresolved: true, actorRemapped: true }
  }
  const namespace = actors[0].source_namespace
  const forward = await readForwardPortableMappings(namespace, wanted)
  const reverse = await readPortableMappings(namespace, wanted)
  return { ...decidePortablePayload(wanted, forward, reverse, actors.length), actorRemapped: true }
}

async function remapPortablePayload(
  sourceNamespace: string,
  operation: string,
  payload: unknown
): Promise<unknown> {
  const wanted = portablePayloadIds(operation, payload)
  const mappings = await readPortableMappings(sourceNamespace, wanted)
  const reverse = new Map(mappings.map((row) => [`${row.entity}\u0000${row.destination_id}`, row.source_id]))
  const sourceId = (entity: string, value: unknown) =>
    typeof value === 'string' ? reverse.get(`${entity}\u0000${value}`) ?? value : value
  if (!payload || typeof payload !== 'object') return payload
  if (Array.isArray(payload)) {
    if (operation !== 'create_leave') return payload
    return payload.map((row) => row && typeof row === 'object'
      ? { ...row, userId: sourceId('profiles', (row as Record<string, unknown>).userId) }
      : row)
  }
  const p = payload as Record<string, unknown>
  const copy: Record<string, unknown> = { ...p }
  if (operation === 'create_timesheet' || operation === 'update_timesheet') {
    copy.userId = sourceId('profiles', p.userId)
    copy.projectId = sourceId('projects', p.projectId)
    copy.activityTypeId = sourceId('activity_types', p.activityTypeId)
  }
  if (operation === 'update_timesheet' || operation === 'delete_timesheet') copy.id = sourceId('timesheets', p.id)
  if (operation === 'delete_leave') copy.id = sourceId('leaves', p.id)
  if (operation === 'update_reminder' || operation === 'delete_reminder') copy.id = sourceId('reminders', p.id)
  if (operation === 'create_leave' && Array.isArray(p.rows)) {
    copy.rows = p.rows.map((row) => row && typeof row === 'object'
      ? { ...row, userId: sourceId('profiles', (row as Record<string, unknown>).userId) }
      : row)
  }
  return copy
}

function busyResponse(
  code:
    | 'IDEMPOTENCY_IN_FLIGHT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'IDEMPOTENCY_NAMESPACE_AMBIGUOUS'
    | 'IDEMPOTENCY_REVIEW_REQUIRED',
  message: string
): Response {
  return Response.json({ data: null, error: { code, message } }, { status: 409 })
}

function commitUnknownResponse(): Response {
  return Response.json(
    {
      data: null,
      error: {
        code: 'IDEMPOTENCY_COMMIT_UNKNOWN',
        message: 'The operation already completed but its outcome could not be recorded. Do not re-run this mutation.',
      },
    },
    { status: 409 }
  )
}

function stampedSuccessResponse(status: number): Response {
  return Response.json({ data: { success: true }, error: null }, { status })
}

/**
 * Resolve portable retry history and classify an unrecorded queued payload.
 * A null result means the caller may continue through ordinary idempotency.
 */
export async function preparePortableRetry(
  key: string,
  actorId: string,
  operation: string,
  payload: unknown,
  dependencies: PortableRetryDependencies
): Promise<Response | null> {
  if (!PORTABLE_OPERATIONS.has(operation)) return null

  const imported = await readPortableRetryRows(key, actorId, operation)
  const matches: PortableRetryRow[] = []
  for (const row of imported) {
    if (row.outcome !== 'committed' || !row.fingerprint) continue
    const sourcePayload = await remapPortablePayload(row.source_namespace, operation, payload)
    const incoming = row.fingerprint_kind === 'request-json-v1'
      ? computePayloadFingerprint(sourcePayload)
      : await dependencies.computeEffectFingerprint(
          operation,
          canonicalEffectPayload(operation, sourcePayload, row.source_actor_id)
        )
    if (incoming === row.fingerprint) matches.push(row)
  }

  const localState = await dependencies.localState(key, actorId, operation, payload)
  if (localState === 'uncertain') return commitUnknownResponse()
  if (localState === 'in_flight') {
    return busyResponse(
      'IDEMPOTENCY_IN_FLIGHT',
      'A request with this idempotency key is already in progress. Retry with the same key.'
    )
  }

  const localMatch = localState === 'match'
  if (matches.length + (localMatch ? 1 : 0) > 1) {
    return busyResponse(
      'IDEMPOTENCY_NAMESPACE_AMBIGUOUS',
      'The idempotency key matches histories from multiple deployment namespaces.'
    )
  }
  if (localMatch) return null

  if (imported.length > 0) {
    const match = matches[0]
    if (!match) {
      if (imported.some((row) => row.outcome === 'uncertain')) return commitUnknownResponse()
      return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
    }
    const denied = await dependencies.reauthorize({ responseStatus: match.response_status })
    return denied ?? stampedSuccessResponse(match.response_status)
  }

  if (localState === 'conflict') {
    return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
  }

  const classification = await classifyPortablePayload(actorId, operation, payload)
  if (classification.outcome === 'review') {
    return busyResponse(
      'IDEMPOTENCY_NAMESPACE_AMBIGUOUS',
      `This queued operation requires manual review: ${classification.reason ?? 'its identifiers cannot be resolved safely'}.`
    )
  }
  if (classification.outcome === 'translate') {
    applyPortableTranslation(operation, payload, classification.translation)
  }
  if (classification.outcome === 'destination-era' && classification.actorRemapped && classification.unresolved) {
    const referenceFreeCreate =
      (operation === 'create_reminder' || operation === 'create_leave') &&
      portablePayloadIds(operation, payload).length === 0
    const admitted = referenceFreeCreate && await admitsFreshKey(key, actorId, operation)
    if (!admitted) {
      return busyResponse(
        'IDEMPOTENCY_REVIEW_REQUIRED',
        'This queued operation predates the migration or cannot be proven current. It was not executed and requires manual review.'
      )
    }
  }

  return null
}

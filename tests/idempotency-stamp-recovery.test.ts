import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  withIdempotency,
  claimIdempotencyKey,
  computePayloadFingerprint,
} from '@/lib/idempotency'
import { runWithIdempotencyScope } from '@/lib/idempotency-key'

// T19.2 constraint-backed effect idempotency (Supabase branch, IS_NATIVE=false).
// Business rows carry the delivery's idempotency key (see 0031 / 20260920
// migrations); a repeat delivery collides on that evidence instead of
// duplicating the effect, and the adapter converts the evidence into a
// ledger-backed replay without re-executing (no double budget/audit charge).
// No raw-SQL mutation executor is involved: every write still flows through
// the domain/repository path under the request bearer client.

vi.mock('server-only', () => ({}))

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: false,
  IS_SUPABASE: true,
}))

const { mockGetAdminClient, mockCreateClient, mockReserveWriteRateLimit } = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn(),
  mockCreateClient: vi.fn(),
  mockReserveWriteRateLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: mockGetAdminClient,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/rate-limit', () => ({
  reserveWriteRateLimit: mockReserveWriteRateLimit,
}))

import { supabaseRepository } from '@/lib/db/supabase'
import { withServiceWriteBudget } from '@/lib/api/v1/services/_write-budget'
import { DuplicateDeliveryError } from '@/lib/idempotency-key'
import type { Actor } from '@/lib/db/repository'

type BizRow = Record<string, unknown>

const biz: Record<string, Map<string, BizRow>> = {
  timesheets: new Map(),
  leaves: new Map(),
  reminders: new Map(),
}
interface EffectRecord {
  status: number
  fp: string
}

const effects = new Map<string, EffectRecord>()
let bizSeq = 0
let effectLookupFails = false
let legacyLookupFails = false

function effectId(key: string, operation: string) {
  return `${key}:user-1:${operation}`
}

function recordEffect(key: string, operation: string, fp = 'fp') {
  effects.set(effectId(key, operation), {
    status: operation.startsWith('create_') ? 201 : 200,
    fp,
  })
}

interface LedgerRecord {
  fp: string
  status: number
  payload: unknown
  claimedAt: string
  committedUnknown?: boolean
}

const ledger = new Map<string, LedgerRecord>()

function applyEq(rows: BizRow[], filters: Array<[string, unknown]>): BizRow[] {
  return rows.filter((r) => filters.every(([c, v]) => r[c] === v))
}

function buildBizClient() {
  return {
    from: (table: string) => {
      if (table === 'idempotency_effects') {
        const filters: Array<[string, unknown]> = []
        const builder = {
          eq: (c: string, v: unknown) => {
            filters.push([c, v])
            return builder
          },
          limit: () => builder,
          maybeSingle: async () => {
            if (effectLookupFails) {
              return { data: null, error: { message: 'effect table unavailable' } }
            }
            const key = filters.find(([c]) => c === 'key')?.[1]
            const operation = filters.find(([c]) => c === 'operation')?.[1]
            const record =
              typeof key === 'string' && typeof operation === 'string'
                ? effects.get(effectId(key, operation))
                : undefined
            return {
              data: record
                ? {
                    response_status: record.status,
                    effect_fingerprint: record.fp,
                    resource_id: null,
                  }
                : null,
              error: null,
            }
          },
        }
        return { select: () => builder }
      }
      const rows = () => Array.from(biz[table].values())
      return {
        insert: (payload: BizRow | BizRow[]) => {
          const list = Array.isArray(payload) ? payload : [payload]
          let violation: { code: string; message: string } | null = null
          if (!violation && table === 'leaves') {
            for (const row of list) {
              if (rows().some((r) => r.user_id === row.user_id && r.leave_date === row.leave_date)) {
                violation = {
                  code: '23505',
                  message:
                    'duplicate key value violates unique constraint "leaves_user_id_leave_date_key" table leaves',
                }
                break
              }
            }
          }
          const inserted = violation
            ? []
            : list.map((row) => {
                const full = { id: `row-${++bizSeq}`, ...row }
                biz[table].set(full.id as string, full)
                return full
              })
          const outcome = violation
            ? { data: null, error: violation }
            : { data: inserted, error: null }
          const select = (_cols: string) => {
            const builder = {
              setHeader: () => builder,
              maybeSingle: () => {
                const result = Object.assign(
                  Promise.resolve(
                    violation
                      ? { data: null, error: violation }
                      : { data: inserted[0] ?? null, error: null }
                  ),
                  { setHeader: () => result }
                )
                return result
              },
            }
            return builder
          }
          const request = Object.assign(Promise.resolve(outcome), { select })
          return Object.assign(request, { setHeader: () => request })
        },
        select: (_cols: string) => {
          const filters: Array<[string, unknown]> = []
          const builder: {
            eq: (c: string, v: unknown) => typeof builder
            limit: (n: number) => typeof builder
            maybeSingle: () => Promise<{ data: BizRow | null; error: null }>
          } = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v])
              return builder
            },
            limit: (_n: number) => builder,
            maybeSingle: async () => ({ data: applyEq(rows(), filters)[0] ?? null, error: null }),
          }
          return builder
        },
        update: (vals: BizRow) => {
          const filters: Array<[string, unknown]> = []
          const builder = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v])
              return builder
            },
            setHeader: () => builder,
          } as {
            eq: (c: string, v: unknown) => unknown
            then?: unknown
          }
          builder.then = (
            res: (v: { data: BizRow[]; error: null }) => unknown,
            rej: (e: unknown) => unknown
          ) => {
            const hits = applyEq(rows(), filters)
            for (const h of hits) Object.assign(h, vals)
            return Promise.resolve({ data: hits, error: null }).then(res, rej)
          }
          return builder
        },
        delete: () => {
          const filters: Array<[string, unknown]> = []
          const builder = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v])
              return builder
            },
            setHeader: () => builder,
          } as {
            eq: (c: string, v: unknown) => unknown
            then?: unknown
          }
          builder.then = (
            res: (v: { data: BizRow[]; error: null }) => unknown,
            rej: (e: unknown) => unknown
          ) => {
            const hits = applyEq(rows(), filters)
            for (const h of hits) biz[table].delete(h.id as string)
            return Promise.resolve({ data: hits, error: null }).then(res, rej)
          }
          return builder
        },
      }
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'idempotency_effect_fingerprint') {
        return { data: 'fp', error: null }
      }
      if (name === 'create_leaves_idempotent') {
        const key = args.p_key as string
        const rows = (args.p_rows as BizRow[]) ?? []
        const id = effectId(key, 'create_leave')
        const existing = effects.get(id)
        if (existing) {
          if (existing.fp !== 'fp') {
            return {
              data: null,
              error: {
                code: 'P0001',
                message: 'IDEMPOTENCY_CONFLICT: Idempotency key reused with a different payload.',
              },
            }
          }
          return { data: null, error: { code: '23505', message: 'Idempotency effect already applied.' } }
        }
        let violation: { code: string; message: string } | null = null
        for (const row of rows) {
          if (
            Array.from(biz.leaves.values()).some(
              (r) => r.user_id === row.user_id && r.leave_date === row.leave_date
            )
          ) {
            violation = {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "leaves_user_id_leave_date_key" table leaves',
            }
            break
          }
        }
        if (violation) return { data: null, error: violation }
        for (const row of rows) {
          const full = { id: `row-${++bizSeq}`, ...row }
          biz.leaves.set(full.id as string, full)
        }
        effects.set(id, { status: 201, fp: 'fp' })
        return { data: { success: true }, error: null }
      }
      return { data: null, error: { message: `Unknown rpc ${name}` } }
    },
  }
}

function buildAdminClient() {
  return {
    from: (table: string) => {
      if (table === 'idempotency_effects') {
        const filters: Array<[string, unknown]> = []
        const effectsBuilder = {
          eq: (c: string, v: unknown) => {
            filters.push([c, v])
            return effectsBuilder
          },
          maybeSingle: async () => {
            const key = filters.find(([c]) => c === 'key')?.[1]
            const actorId = filters.find(([c]) => c === 'actor_id')?.[1]
            const operation = filters.find(([c]) => c === 'operation')?.[1]
            const id =
              typeof key === 'string' && typeof actorId === 'string' && typeof operation === 'string'
                ? effectId(key, operation)
                : null
            const record = id ? effects.get(id) : undefined
            return {
              data: record
                ? {
                    response_status: record.status,
                    effect_fingerprint: record.fp,
                    resource_id: null,
                  }
                : null,
              error: null,
            }
          },
        }
        return { select: (_columns: string) => effectsBuilder }
      }
      const insert = async (row: Record<string, unknown>) => {
        const c = `${row.key}:${row.actor_id}:${row.operation}`
        if (ledger.has(c)) return { error: { code: '23505', message: 'duplicate' } }
        ledger.set(c, {
          fp: row.payload_fingerprint as string,
          status: 0,
          payload: {},
          claimedAt: (row.claimed_at as string) ?? new Date().toISOString(),
          committedUnknown: Boolean(row.committed_unknown),
        })
        return { error: null }
      }
      const select = (_columns: string) => ({
        eq: (_c1: string, v1: string) => ({
          eq: (_c2: string, v2: string) => ({
            eq: (_c3: string, v3: string) => ({
              maybeSingle: async () => {
                if (legacyLookupFails) {
                  return { data: null, error: { message: 'ledger table unavailable' } }
                }
                const c = `${v1}:${v2}:${v3}`
                const rec = ledger.get(c)
                return {
                  data: rec
                    ? {
                        payload_fingerprint: rec.fp,
                        response_status: rec.status,
                        response_payload: rec.payload,
                        claimed_at: rec.claimedAt,
                        committed_unknown: Boolean(rec.committedUnknown),
                      }
                    : null,
                  error: null,
                }
              },
            }),
          }),
        }),
      })
      const update = (vals: Record<string, unknown>) => ({
        eq: (_c1: string, v1: string) => ({
          eq: (_c2: string, v2: string) => ({
            eq: (_c3: string, v3: string) => {
              const c = `${v1}:${v2}:${v3}`
              const rec = ledger.get(c)
              if (rec) {
                if ('response_status' in vals) {
                  rec.status = vals.response_status as number
                  rec.payload = vals.response_payload as unknown
                }
                if ('committed_unknown' in vals) {
                  rec.committedUnknown = Boolean(vals.committed_unknown)
                }
              }
              return Promise.resolve({ error: null })
            },
          }),
        }),
      })
      const del = () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }),
        }),
      })
      return { insert, select, update, delete: del }
    },
    rpc: async (name: string) => {
      if (name === 'idempotency_effect_fingerprint') return { data: 'fp', error: null }
      return { data: null, error: { message: `Unknown rpc ${name}` } }
    },
  }
}

const user: Actor = {
  id: 'user-1',
  email: 'user@x.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'user',
  isActive: true,
}

const TS_INPUT = {
  userId: 'user-1',
  projectId: 'p1',
  activityTypeId: null,
  hoursWorked: 4,
  workDone: 'recovery work',
  logDate: '2026-08-28',
}

function keyedRequest(key: string) {
  return new Request('http://localhost/x', { headers: { 'idempotency-key': key } })
}

const ok201 = { data: { success: true }, error: null }

describe('T19.2 stamp recovery (Supabase branch)', () => {
  beforeEach(() => {
    ledger.clear()
    effects.clear()
    effectLookupFails = false
    legacyLookupFails = false
    for (const t of Object.keys(biz)) biz[t].clear()
    bizSeq = 0
    vi.clearAllMocks()
    mockGetAdminClient.mockImplementation(() => buildAdminClient())
    mockCreateClient.mockImplementation(() => buildBizClient())
  })

  it('a keyed create commits once and the retry replays from the immutable effect', async () => {
    const execute = async () => {
      const out = await supabaseRepository.createTimesheet(user, TS_INPUT)
      expect(out.error).toBeNull()
      return Response.json(ok201, { status: 201 })
    }
    const first = await withIdempotency(keyedRequest('k-create-1'), user.id, 'create_timesheet', TS_INPUT, execute, {
      successStatus: 201,
    })
    expect(first.status).toBe(201)
    expect(biz.timesheets.size).toBe(1)

    // The production AFTER trigger records the immutable effect in the same
    // transaction as the business write (simulated here).
    recordEffect('k-create-1', 'create_timesheet')
    const retry = await withIdempotency(keyedRequest('k-create-1'), user.id, 'create_timesheet', TS_INPUT, execute, {
      successStatus: 201,
    })
    expect(retry.status).toBe(201)
    expect(await retry.json()).toEqual(ok201)
    expect(biz.timesheets.size).toBe(1)
  })

  it('a repeat delivery after a committed effect replays without duplicating the row', async () => {
    const execute = async () => {
      const out = await supabaseRepository.createTimesheet(user, TS_INPUT)
      expect(out.error).toBeNull()
      return Response.json(ok201, { status: 201 })
    }
    const first = await withIdempotency(keyedRequest('k-create-2'), user.id, 'create_timesheet', TS_INPUT, execute, {
      successStatus: 201,
    })
    expect(first.status).toBe(201)
    expect(biz.timesheets.size).toBe(1)
    recordEffect('k-create-2', 'create_timesheet')

    const retry = await withIdempotency(keyedRequest('k-create-2'), user.id, 'create_timesheet', TS_INPUT, execute, {
      successStatus: 201,
    })
    expect(retry.status).toBe(201)
    expect(await retry.json()).toEqual(ok201)
    // Exactly one committed effect for two deliveries.
    expect(biz.timesheets.size).toBe(1)
  })

  it('a natural unique violation without an effect keeps its original validation mapping', async () => {
    // Seed the same leave date through an unkeyed write (no effect).
    const seed = await supabaseRepository.createLeaves(user, [
      { userId: 'user-1', leaveDate: '2026-09-01', reason: 'seed' },
    ])
    expect(seed.error).toBeNull()

    const out = await runWithIdempotencyScope({ key: 'k-leave-dup', operation: 'create_leave' }, () =>
      supabaseRepository.createLeaves(user, [{ userId: 'user-1', leaveDate: '2026-09-01', reason: 'again' }])
    )
    expect(out.error).toBe('One or more of those leave dates is already marked.')
    expect(biz.leaves.size).toBe(1)
  })

  it('fails closed before a keyed write when immutable effect evidence is unavailable', async () => {
    effectLookupFails = true
    await expect(
      runWithIdempotencyScope({ key: 'k-effect-unavailable', operation: 'create_timesheet' }, () =>
        supabaseRepository.createTimesheet(user, TS_INPUT)
      )
    ).rejects.toThrow('Idempotency effect lookup failed: effect table unavailable')
    expect(biz.timesheets.size).toBe(0)
  })

  it('a keyed update proves prior application without rewriting concurrent work', async () => {
    // Seed the row unkeyed so the first keyed update is a genuine application.
    const seed = await supabaseRepository.createTimesheet(user, TS_INPUT)
    expect(seed.error).toBeNull()

    const applyUpdate = async () => {
      const out = await supabaseRepository.updateTimesheet(user, 'row-1', { ...TS_INPUT, hoursWorked: 6 })
      expect(out.error).toBeNull()
      return Response.json({ data: { success: true }, error: null }, { status: 200 })
    }
    const first = await withIdempotency(keyedRequest('k-upd-1'), user.id, 'update_timesheet', { id: 'row-1' }, applyUpdate)
    expect(first.status).toBe(200)
    expect((biz.timesheets.get('row-1') as BizRow).hours_worked).toBe(6)
    // The AFTER trigger committed the effect; a newer keyed write lands before
    // the retry arrives. Unlike a mutable row stamp, it does not erase the
    // earlier effect evidence.
    recordEffect('k-upd-1', 'update_timesheet')
    ;(biz.timesheets.get('row-1') as BizRow).hours_worked = 8
    recordEffect('k-upd-2', 'update_timesheet')
    expect(effects.has(effectId('k-upd-1', 'update_timesheet'))).toBe(true)

    const retry = await withIdempotency(keyedRequest('k-upd-1'), user.id, 'update_timesheet', { id: 'row-1' }, applyUpdate)
    expect(retry.status).toBe(200)
    // No clobber of the newer write, no duplicate effect.
    expect((biz.timesheets.get('row-1') as BizRow).hours_worked).toBe(8)
  })

  it('a legacy committed-unknown key with immutable effect evidence replays', async () => {
    const payload = { userId: 'user-1', message: 'hi', remindAt: '2026-09-01T10:00:00.000Z' }
    await claimIdempotencyKey('k-unknown-1', user.id, 'create_reminder', computePayloadFingerprint(payload))
    // The business mutation committed; recording it was lost.
    await runWithIdempotencyScope({ key: 'k-unknown-1', operation: 'create_reminder' }, () =>
      supabaseRepository.createReminder(user, payload)
    )
    recordEffect('k-unknown-1', 'create_reminder')
    ledger.get('k-unknown-1:user-1:create_reminder')!.committedUnknown = true

    const execute = async () => {
      const out = await supabaseRepository.createReminder(user, payload)
      expect(out.error).toBeNull()
      return Response.json(ok201, { status: 201 })
    }
    const res = await withIdempotency(keyedRequest('k-unknown-1'), user.id, 'create_reminder', payload, execute, {
      successStatus: 201,
    })
    expect(res.status).toBe(201)
    expect(biz.reminders.size).toBe(1)
  })

  it('a legacy committed-unknown key without evidence stays manual-review (409, no blind re-execution)', async () => {
    const payload = { id: 'ghost', done: true }
    await claimIdempotencyKey('k-unknown-2', user.id, 'update_reminder', computePayloadFingerprint(payload))
    ledger.get('k-unknown-2:user-1:update_reminder')!.committedUnknown = true

    let ran = 0
    const res = await withIdempotency(keyedRequest('k-unknown-2'), user.id, 'update_reminder', payload, async () => {
      ran++
      const out = await supabaseRepository.updateReminder(user, 'ghost', { done: true })
      expect(out.error).toBeNull()
      return Response.json({ data: { success: true }, error: null }, { status: 200 })
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_COMMIT_UNKNOWN')
    // Effect evidence is absent, so the delivery is never re-executed.
    expect(ran).toBe(0)
    expect(biz.reminders.size).toBe(0)
  })

  it('a legacy committed-unknown key whose effect fingerprint differs is a conflict, not a replay', async () => {
    const payload = { userId: 'user-1', message: 'hi', remindAt: '2026-09-01T10:00:00.000Z' }
    await claimIdempotencyKey('k-unknown-conflict', user.id, 'create_reminder', computePayloadFingerprint(payload))
    // Effect evidence exists, but it was committed for a DIFFERENT canonical
    // payload. A committed_unknown row must not blindly replay success — the
    // fingerprint mismatch has to surface as a conflict (finding 1).
    recordEffect('k-unknown-conflict', 'create_reminder', 'other-fingerprint')
    ledger.get('k-unknown-conflict:user-1:create_reminder')!.committedUnknown = true

    let ran = 0
    const res = await withIdempotency(
      keyedRequest('k-unknown-conflict'),
      user.id,
      'create_reminder',
      { userId: 'user-1', message: 'DIFFERENT', remindAt: '2026-09-01T10:00:00.000Z' },
      async () => {
        ran++
        return Response.json(ok201, { status: 201 })
      },
      { successStatus: 201 }
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT')
    // The changed payload never re-executes as a false success.
    expect(ran).toBe(0)
  })

  it('a legacy ledger lookup failure is retryable (throws) and never re-executes', async () => {
    // A lookup failure must fail closed: it must not return null and let an old
    // committed ledger row slip past so the mutation runs a second time
    // (finding 3).
    legacyLookupFails = true
    let ran = 0
    await expect(
      withIdempotency(
        keyedRequest('k-legacy-unavailable'),
        user.id,
        'create_timesheet',
        TS_INPUT,
        async () => {
          ran++
          return Response.json(ok201, { status: 201 })
        },
        { successStatus: 201 }
      )
    ).rejects.toThrow('Idempotency ledger lookup failed: ledger table unavailable')
    expect(ran).toBe(0)
    expect(biz.timesheets.size).toBe(0)
  })

  it('a keyed delete retried after the target is gone replays the committed success', async () => {
    // The delete committed earlier and its immutable effect still exists even
    // though the target row is gone.
    recordEffect('k-del-1', 'delete_timesheet')

    // The service-level pre-read returns NOT_FOUND before reaching the adapter
    // guard; the wrapper must still recover the committed success instead of
    // re-running the mutation or dropping the work.
    const res = await withIdempotency(keyedRequest('k-del-1'), user.id, 'delete_timesheet', { id: 'gone-1' }, async () => {
      return Response.json({ data: null, error: { code: 'NOT_FOUND', message: 'Timesheet entry not found.' } }, { status: 404 })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(ok201)
  })

  it('a keyed update retried after the target is deleted replays the committed success', async () => {
    recordEffect('k-upd-del', 'update_timesheet')
    const res = await withIdempotency(keyedRequest('k-upd-del'), user.id, 'update_timesheet', { id: 'gone-2' }, async () => {
      return Response.json({ data: null, error: { code: 'NOT_FOUND', message: 'Timesheet entry not found.' } }, { status: 404 })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(ok201)
  })

  it('reauthorizes before returning a stored replay (demoted actor denied)', async () => {
    recordEffect('k-reauth-1', 'delete_timesheet')
    const denied = Response.json({ data: null, error: { code: 'FORBIDDEN', message: 'No longer authorized.' } }, { status: 403 })
    const res = await withIdempotency(
      keyedRequest('k-reauth-1'),
      user.id,
      'delete_timesheet',
      { id: 'x' },
      async () => {
        const out = await supabaseRepository.deleteTimesheet(user, 'gone-x')
        expect(out).toBeDefined()
        return Response.json(ok201, { status: 200 })
      },
      { reauthorize: async () => denied }
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')
  })

  it('non-queued operations never create effect evidence', async () => {
    const out = await runWithIdempotencyScope({ key: 'k-dup-1', operation: 'duplicate_timesheet' }, () =>
      supabaseRepository.createTimesheet(user, TS_INPUT)
    )
    expect(out.error).toBeNull()
    expect(effects.size).toBe(0)
  })

  it('unkeyed writes neither create nor probe effect evidence', async () => {
    const out = await supabaseRepository.createTimesheet(user, TS_INPUT)
    expect(out.error).toBeNull()
    expect(effects.size).toBe(0)
    const upd = await supabaseRepository.updateTimesheet(user, 'row-1', { ...TS_INPUT, hoursWorked: 2 })
    expect(upd.error).toBeNull()
    expect(effects.size).toBe(0)
  })

  it('a duplicate-delivery throw inside budgeted work releases the slot (no double charge)', async () => {
    const release = vi.fn(async () => {})
    mockReserveWriteRateLimit.mockResolvedValue({ ok: true, reservation: { release } })
    const err = await withServiceWriteBudget('actor-1', () => ({ tag: 'limited' }), async () => {
      throw new DuplicateDeliveryError('create_timesheet', 'k-budget-1')
    }, () => true).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DuplicateDeliveryError)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('a reused key with a different payload is a conflict, not a false replay', async () => {
    // The committed effect carries a different canonical fingerprint.
    recordEffect('k-conflict-1', 'create_timesheet', 'other-fingerprint')
    const execute = async () => {
      const out = await supabaseRepository.createTimesheet(user, TS_INPUT)
      expect(out).toBeDefined()
      return Response.json(ok201, { status: 201 })
    }
    const res = await withIdempotency(keyedRequest('k-conflict-1'), user.id, 'create_timesheet', TS_INPUT, execute, {
      successStatus: 201,
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT')
    // The preflight refuses before the write, so no duplicate row is created.
    expect(biz.timesheets.size).toBe(0)
  })

  it('a deleted-resource retry with a different payload is a conflict, not a false replay', async () => {
    recordEffect('k-conflict-del', 'delete_timesheet', 'other-fingerprint')
    const res = await withIdempotency(keyedRequest('k-conflict-del'), user.id, 'delete_timesheet', { id: 'gone-9' }, async () => {
      return Response.json({ data: null, error: { code: 'NOT_FOUND', message: 'Timesheet entry not found.' } }, { status: 404 })
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('a keyed delete_leave commits once and the retry replays from the immutable effect', async () => {
    biz.leaves.set('leave-1', { id: 'leave-1', user_id: user.id, leave_date: '2026-09-20', reason: '' })
    let ran = 0
    const execute = async () => {
      ran++
      const out = await supabaseRepository.deleteLeave(user, 'leave-1')
      expect(out.error).toBeNull()
      return Response.json(ok201, { status: 200 })
    }
    const first = await withIdempotency(keyedRequest('k-del-leave-ok'), user.id, 'delete_leave', { id: 'leave-1' }, execute)
    expect(first.status).toBe(200)
    expect(biz.leaves.size).toBe(0)
    expect(ran).toBe(1)

    // The AFTER trigger records the immutable effect in the same transaction as
    // the business delete (simulated here).
    recordEffect('k-del-leave-ok', 'delete_leave')
    const retry = await withIdempotency(keyedRequest('k-del-leave-ok'), user.id, 'delete_leave', { id: 'leave-1' }, execute)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual(ok201)
    // Replayed from evidence — the mutation did not run a second time.
    expect(ran).toBe(1)
  })

  it('a keyed delete_leave retried after the target is gone replays the committed success', async () => {
    // The delete committed earlier and its immutable effect still exists even
    // though the target leave row is gone.
    recordEffect('k-del-leave-gone', 'delete_leave')
    const res = await withIdempotency(keyedRequest('k-del-leave-gone'), user.id, 'delete_leave', { id: 'gone-l1' }, async () => {
      return Response.json({ data: null, error: { code: 'NOT_FOUND', message: 'Leave entry not found.' } }, { status: 404 })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(ok201)
  })

  it('a deleted-resource delete_leave retry with a different payload is a conflict, not a false replay', async () => {
    recordEffect('k-del-leave-conflict', 'delete_leave', 'other-fingerprint')
    const res = await withIdempotency(keyedRequest('k-del-leave-conflict'), user.id, 'delete_leave', { id: 'gone-l9' }, async () => {
      return Response.json({ data: null, error: { code: 'NOT_FOUND', message: 'Leave entry not found.' } }, { status: 404 })
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('reauthorizes before returning a stored delete_leave replay (demoted actor denied)', async () => {
    recordEffect('k-reauth-leave', 'delete_leave')
    const denied = Response.json({ data: null, error: { code: 'FORBIDDEN', message: 'No longer authorized.' } }, { status: 403 })
    const res = await withIdempotency(
      keyedRequest('k-reauth-leave'),
      user.id,
      'delete_leave',
      { id: 'x' },
      async () => {
        const out = await supabaseRepository.deleteLeave(user, 'gone-x')
        expect(out).toBeDefined()
        return Response.json(ok201, { status: 200 })
      },
      { reauthorize: async () => denied }
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')
  })

  it('a changed later row in a create_leave batch is a conflict', async () => {
    recordEffect('k-leave-batch', 'create_leave', 'other-fingerprint')
    const execute = async () => {
      const out = await supabaseRepository.createLeaves(user, [
        { userId: user.id, leaveDate: '2026-09-10', reason: 'first' },
        { userId: user.id, leaveDate: '2026-09-11', reason: 'changed' },
      ])
      expect(out).toBeDefined()
      return Response.json(ok201, { status: 201 })
    }
    const res = await withIdempotency(
      keyedRequest('k-leave-batch'),
      user.id,
      'create_leave',
      { rows: [{ userId: user.id, leaveDate: '2026-09-10', reason: 'first' }] },
      execute,
      { successStatus: 201 }
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(biz.leaves.size).toBe(0)
  })

  it('an identical create_leave batch replay succeeds without duplicating rows', async () => {
    const rows = [{ userId: user.id, leaveDate: '2026-09-12', reason: 'same' }]
    const execute = async () => {
      const out = await supabaseRepository.createLeaves(user, rows)
      expect(out.error).toBeNull()
      return Response.json(ok201, { status: 201 })
    }
    const first = await withIdempotency(keyedRequest('k-leave-ok'), user.id, 'create_leave', { rows }, execute, {
      successStatus: 201,
    })
    expect(first.status).toBe(201)
    expect(biz.leaves.size).toBe(1)

    const retry = await withIdempotency(keyedRequest('k-leave-ok'), user.id, 'create_leave', { rows }, execute, {
      successStatus: 201,
    })
    expect(retry.status).toBe(201)
    expect(await retry.json()).toEqual(ok201)
    expect(biz.leaves.size).toBe(1)
  })

  it('a legacy committed row with a different payload fingerprint is a conflict, not a replay', async () => {
    const payload = { userId: user.id, message: 'hi', remindAt: '2026-09-01T10:00:00.000Z' }
    await claimIdempotencyKey('k-leg-conflict', user.id, 'create_reminder', computePayloadFingerprint(payload))
    ledger.get('k-leg-conflict:user-1:create_reminder')!.status = 201

    let ran = 0
    const res = await withIdempotency(
      keyedRequest('k-leg-conflict'),
      user.id,
      'create_reminder',
      { userId: user.id, message: 'DIFFERENT', remindAt: '2026-09-01T10:00:00.000Z' },
      async () => {
        ran++
        return Response.json(ok201, { status: 201 })
      },
      { successStatus: 201 }
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(ran).toBe(0)
    expect(biz.reminders.size).toBe(0)
  })

  it('a legacy in-flight row (status 0, not committed-unknown) is never reported as success', async () => {
    const payload = { userId: user.id, message: 'hi', remindAt: '2026-09-01T10:00:00.000Z' }
    await claimIdempotencyKey('k-leg-inflight', user.id, 'create_reminder', computePayloadFingerprint(payload))

    let ran = 0
    const res = await withIdempotency(
      keyedRequest('k-leg-inflight'),
      user.id,
      'create_reminder',
      payload,
      async () => {
        ran++
        return Response.json(ok201, { status: 201 })
      },
      { successStatus: 201 }
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_IN_FLIGHT')
    expect(ran).toBe(0)
    expect(biz.reminders.size).toBe(0)
  })

  it('a legacy committed row with a matching fingerprint replays without re-executing', async () => {
    const payload = { userId: user.id, message: 'hi', remindAt: '2026-09-01T10:00:00.000Z' }
    await claimIdempotencyKey('k-leg-ok', user.id, 'create_reminder', computePayloadFingerprint(payload))
    ledger.get('k-leg-ok:user-1:create_reminder')!.status = 200

    let ran = 0
    const res = await withIdempotency(
      keyedRequest('k-leg-ok'),
      user.id,
      'create_reminder',
      payload,
      async () => {
        ran++
        return Response.json(ok201, { status: 201 })
      },
      { successStatus: 201 }
    )
    expect(res.status).toBe(200)
    expect(ran).toBe(0)
  })

  it('probes immutable effect evidence before business validation can mask a committed write', async () => {
    // The mutation committed (lost response) and a retry would now trip
    // business validation (e.g. daily hours already at 24h). The wrapper must
    // replay the committed success from the effect without re-executing.
    recordEffect('k-probe-1', 'create_timesheet')
    let ran = 0
    const res = await withIdempotency(
      keyedRequest('k-probe-1'),
      user.id,
      'create_timesheet',
      TS_INPUT,
      async () => {
        ran++
        return Response.json(
          { data: null, error: { code: 'DAILY_HOURS_EXCEEDED', message: 'Daily total would exceed 24 hours.' } },
          { status: 400 }
        )
      },
      { successStatus: 201 }
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(ok201)
    expect(ran).toBe(0)
  })
})

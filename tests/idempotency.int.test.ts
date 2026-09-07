// tests/idempotency.int.test.ts
// Live PostgreSQL integration tests for idempotency lifecycle:
// claim -> execute -> commit -> replay / conflict / release
// Runs only when TEST_DATABASE_URL is set.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import {
  claimIdempotencyKey,
  commitIdempotencyKey,
  releaseIdempotencyKey,
  withIdempotency,
  computePayloadFingerprint,
} from '@/lib/idempotency'

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
}))

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

suite('idempotency live database lifecycle', () => {
  const pool = new Pool({ connectionString: url })
  let actorId: string
  let projectId: string

  beforeAll(async () => {
    if (url) {
      process.env.DATABASE_URL = url
    }
    const userRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active)
       values ('idemp.tester@example.com', 'Idemp Tester', 'user', true)
       on conflict (email) do update set is_active = true
       returning id`
    )
    actorId = userRes.rows[0].id
    const projRes = await pool.query<{ id: string }>(
      `insert into public.projects (name) values ('Idemp Tracer Project')
       on conflict (name) do update set name = excluded.name
       returning id`
    )
    projectId = projRes.rows[0].id
  })

  afterAll(async () => {
    await pool.query(`delete from public.timesheets where user_id = $1`, [actorId])
    await pool.query(`delete from public.idempotency_keys where actor_id = $1`, [actorId])
    await pool.query(`delete from public.profiles where id = $1`, [actorId])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(`delete from public.idempotency_keys where actor_id = $1`, [actorId])
    await pool.query(`delete from public.timesheets where user_id = $1`, [actorId])
  })

  run('atomic claim, commit, and replay lifecycle on live Postgres', async () => {
    const key = `key-${Date.now()}-1`
    const operation = 'create_timesheet'
    const payload = { projectId: 'p1', hours: 4 }
    const fp = computePayloadFingerprint(payload)

    // 1. First claim succeeds
    const claim1 = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(claim1.state).toBe('claimed')

    // 2. In-flight claim with same key is transient in-flight (status=0)
    const inFlightClaim = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(inFlightClaim.state).toBe('in_flight')

    // 3. Commit with result
    await commitIdempotencyKey(key, actorId, operation, 201, { id: 'entry-123' })

    // 4. Replay with identical payload returns committed state
    const replayClaim = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(replayClaim.state).toBe('replay')
    if (replayClaim.state === 'replay') {
      expect(replayClaim.record.status).toBe(201)
      expect(replayClaim.record.payload).toEqual({ id: 'entry-123' })
    }

    // 5. Replay with different payload returns conflict
    const differentFp = computePayloadFingerprint({ projectId: 'p2', hours: 5 })
    const conflictClaim = await claimIdempotencyKey(key, actorId, operation, differentFp)
    expect(conflictClaim.state).toBe('conflict')
  })

  run('releaseIdempotencyKey clears uncommitted key and allows subsequent claim', async () => {
    const key = `key-${Date.now()}-release`
    const operation = 'create_timesheet'
    const fp = computePayloadFingerprint({ test: 'release' })

    const claim = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(claim.state).toBe('claimed')

    // Release uncommitted key
    await releaseIdempotencyKey(key, actorId, operation)

    // Can claim again after release
    const reclaim = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(reclaim.state).toBe('claimed')
  })

  run('concurrent claims race: exactly one claims, others receive conflict', async () => {
    const key = `key-${Date.now()}-race`
    const operation = 'create_timesheet'
    const fp = computePayloadFingerprint({ test: 'race' })

    // Fire 5 simultaneous claims
    const promises = Array.from({ length: 5 }, () =>
      claimIdempotencyKey(key, actorId, operation, fp)
    )
    const results = await Promise.all(promises)

    const claimed = results.filter((r) => r.state === 'claimed')
    const inFlight = results.filter((r) => r.state === 'in_flight')

    expect(claimed).toHaveLength(1)
    expect(inFlight).toHaveLength(4)
  })

  run('stale in-flight claim is reclaimed instead of poisoning the key', async () => {
    const key = `key-${Date.now()}-stale`
    const operation = 'create_timesheet'
    const fp = computePayloadFingerprint({ test: 'stale' })

    const first = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(first.state).toBe('claimed')

    // Simulate a crash between a committed mutation and the ledger commit.
    await pool.query(
      `update public.idempotency_keys set claimed_at = now() - interval '10 minutes'
       where key = $1 and actor_id = $2 and operation = $3`,
      [key, actorId, operation]
    )

    const retry = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(retry.state).toBe('claimed')
  })

  run('changed actor gets an independent claim namespace for the same key', async () => {
    const key = `key-${Date.now()}-actor`
    const operation = 'create_timesheet'
    const fp = computePayloadFingerprint({ test: 'actor' })

    const otherRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active)
       values ('idemp.other@example.com', 'Idemp Other', 'user', true)
       on conflict (email) do update set is_active = true
       returning id`
    )
    const otherId = otherRes.rows[0].id
    try {
      const mine = await claimIdempotencyKey(key, actorId, operation, fp)
      expect(mine.state).toBe('claimed')

      // Same key, different actor: independent ledger namespace, no replay.
      const theirs = await claimIdempotencyKey(key, otherId, operation, fp)
      expect(theirs.state).toBe('claimed')
    } finally {
      await pool.query(`delete from public.idempotency_keys where actor_id = $1`, [otherId])
      await pool.query(`delete from public.profiles where id = $1`, [otherId])
    }
  })

  run('failed execute inside the transaction rolls back the business write and releases the key', async () => {
    const key = `key-${Date.now()}-rollback`
    const operation = 'create_timesheet'
    const payload = { marker: `rollback-${Date.now()}` }
    const marker = `idemp rollback ${payload.marker}`

    const request = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': key },
    })
    // Import the app pool lazily so DATABASE_URL (set in beforeAll) is used.
    const { query } = await import('@/lib/db/pool')
    const throwingExecute = async () => {
      await query(
        `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
         values ($1, $2, '2099-01-01', 2, $3)`,
        [actorId, projectId, marker]
      )
      throw new Error('simulated post-write failure')
    }

    await expect(withIdempotency(request, actorId, operation, payload, throwingExecute)).rejects.toThrow(
      'simulated post-write failure'
    )

    // Real-transaction semantics: the write rolled back with the claim, so the
    // key is claimable again (not poisoned) and no row survived.
    const rows = await pool.query(`select id from public.timesheets where work_done = $1`, [marker])
    expect(rows.rows).toHaveLength(0)
    const retry = await claimIdempotencyKey(key, actorId, operation, computePayloadFingerprint(payload))
    expect(retry.state).toBe('claimed')
  })

  run('restart-before-dequeue replays the durable ledger without re-executing', async () => {
    const key = `key-${Date.now()}-restart`
    const operation = 'create_timesheet'
    const payload = { project: 'P-restart', hours: 3 }

    let executions = 0
    const execute = async () => {
      executions++
      return Response.json({ success: true, run: executions }, { status: 200 })
    }
    const request = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': key },
    })
    const first = await withIdempotency(request, actorId, operation, payload, execute)
    expect(first.status).toBe(200)
    expect(executions).toBe(1)

    // "Restart": all in-memory state is gone; the ledger row in Postgres is
    // the only record. A fresh call replays the stored response.
    const replay = await withIdempotency(request, actorId, operation, payload, execute)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ success: true, run: 1 })
    expect(executions).toBe(1)
  })

  run('replay after the underlying row was deleted returns the stored response (documented policy)', async () => {
    const key = `key-${Date.now()}-deleted`
    const operation = 'create_timesheet'
    const payload = { project: 'P-deleted', hours: 1 }
    const marker = `idemp deleted ${key}`

    let executions = 0
    const { query } = await import('@/lib/db/pool')
    const execute = async () => {
      executions++
      await query(
        `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
         values ($1, $2, '2099-01-02', 1, $3)`,
        [actorId, projectId, marker]
      )
      return Response.json({ success: true }, { status: 200 })
    }
    const request = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': key },
    })
    const first = await withIdempotency(request, actorId, operation, payload, execute)
    expect(first.status).toBe(200)

    // The row is deleted afterwards (e.g. by an admin). Pure idempotency:
    // the retry returns what the original request reported, without
    // re-executing the mutation.
    await pool.query(`delete from public.timesheets where work_done = $1`, [marker])
    const replay = await withIdempotency(request, actorId, operation, payload, execute)
    expect(replay.status).toBe(200)
    expect(executions).toBe(1)
  })

  run('withIdempotency end-to-end: executes once, replays on identical request, rolls back on error', async () => {
    const key = `key-${Date.now()}-with`
    const operation = 'create_timesheet'
    const payload = { project: 'P1', hours: 6 }

    let executionCount = 0
    const executeMutation = async () => {
      executionCount++
      return Response.json({ success: true, count: executionCount }, { status: 200 })
    }

    const request = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': key },
    })

    // Call 1: executes mutation
    const res1 = await withIdempotency(request, actorId, operation, payload, executeMutation)
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1).toEqual({ success: true, count: 1 })
    expect(executionCount).toBe(1)

    // Call 2: identical key + payload replays WITHOUT re-executing
    const res2 = await withIdempotency(request, actorId, operation, payload, executeMutation)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2).toEqual({ success: true, count: 1 })
    expect(executionCount).toBe(1)

    // Call 3: same key + DIFFERENT payload returns 409 conflict
    const res3 = await withIdempotency(request, actorId, operation, { different: true }, executeMutation)
    expect(res3.status).toBe(409)
    expect(executionCount).toBe(1)

    // Call 4: mutation error releases key
    const failingKey = `key-${Date.now()}-fail`
    const failRequest = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': failingKey },
    })
    const failingMutation = async () => {
      return Response.json({ error: 'Database error' }, { status: 500 })
    }
    const failRes = await withIdempotency(failRequest, actorId, operation, payload, failingMutation)
    expect(failRes.status).toBe(500)

    // Key was released: subsequent attempt can claim it
    const recoveryRes = await withIdempotency(failRequest, actorId, operation, payload, executeMutation)
    expect(recoveryRes.status).toBe(200)
  })

  run('committed_unknown row blocks stale takeover and returns committed_unknown on live Postgres', async () => {
    const key = `key-${Date.now()}-comm-unk`
    const operation = 'create_timesheet'
    const payload = { project: 'P1', hours: 4 }
    const fp = computePayloadFingerprint(payload)

    // 1. Initial claim
    const claim = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(claim.state).toBe('claimed')

    // 2. Mark as committed_unknown and set claimed_at to 10 minutes ago
    await pool.query(
      `update public.idempotency_keys
       set committed_unknown = true, claimed_at = now() - interval '10 minutes'
       where key = $1 and actor_id = $2 and operation = $3`,
      [key, actorId, operation]
    )

    // 3. Stale claim attempt must NOT take over: returns committed_unknown
    const retryClaim = await claimIdempotencyKey(key, actorId, operation, fp)
    expect(retryClaim.state).toBe('committed_unknown')

    // 4. withIdempotency returns 409 IDEMPOTENCY_COMMIT_UNKNOWN without re-executing
    let executions = 0
    const request = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': key },
    })
    const res = await withIdempotency(request, actorId, operation, payload, async () => {
      executions++
      return Response.json({ ok: true })
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('IDEMPOTENCY_COMMIT_UNKNOWN')
    expect(executions).toBe(0)
  })
})


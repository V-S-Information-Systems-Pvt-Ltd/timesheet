// tests/logger.test.ts
// Tests for the structured logger: requestId/userId promotion to top-level
// fields, extractError normalization, and level gating.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { logger, extractError, setLogLevel, redactLogMeta, REDACTED } from '../lib/logger'

function capture(level: 'log' | 'info' | 'error' | 'warn' | 'debug') {
  const spy = vi.spyOn(console, level).mockImplementation(() => {})
  return spy
}

afterEach(() => {
  vi.restoreAllMocks()
  setLogLevel('info')
})

describe('logger', () => {
  it('promotes requestId and userId to top-level JSON fields', () => {
    const spy = capture('log')
    logger.info('user action', { requestId: 'req-1', userId: 'u-7', foo: 'bar' })
    const entry = JSON.parse(spy.mock.calls[0][0])
    expect(entry.requestId).toBe('req-1')
    expect(entry.userId).toBe('u-7')
    expect(entry.meta).toEqual({ foo: 'bar' })
    expect(entry.message).toBe('user action')
    expect(entry.level).toBe('info')
  })

  it('omits meta when empty', () => {
    const spy = capture('warn')
    logger.warn('just a message')
    const entry = JSON.parse(spy.mock.calls[0][0])
    expect(entry.meta).toBeUndefined()
    expect(entry.requestId).toBeUndefined()
  })

  it('extractError normalizes arbitrary thrown values', () => {
    expect(extractError(new Error('boom'))).toBe('boom')
    expect(extractError('string error')).toBe('string error')
    expect(extractError({ code: 5 })).toBe('{"code":5}')
    expect(extractError(null)).toBe('null')
  })

  it('respects the log level gate', () => {
    setLogLevel('warn')
    const debugSpy = capture('debug')
    logger.debug('noisy') // suppressed below the min level
    expect(debugSpy).not.toHaveBeenCalled()

    const errorSpy = capture('error')
    logger.error('real problem') // emitted at/above the min level
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})

describe('redactLogMeta', () => {
  it('redacts credentials, tokens and backup bodies but keeps booleans and safe fields', () => {
    const out = redactLogMeta({
      operation: 'backup.restore',
      backend: 'native',
      result: 'success',
      accessToken: 'jwt-secret-value',
      password: 'hunter2',
      refreshTokenHash: 'abc123',
      authorization: 'Bearer super-secret',
      cookie: 'sid=1',
      backupBody: { timesheets: [{ work_done: 'TOP-SECRET' }] },
      payload: '{"big":true}',
      api_key: 'k',
      hasSecretHeader: true,
      userId: 'u-1',
    })!
    expect(out.operation).toBe('backup.restore')
    expect(out.backend).toBe('native')
    expect(out.accessToken).toBe(REDACTED)
    expect(out.password).toBe(REDACTED)
    expect(out.refreshTokenHash).toBe(REDACTED)
    expect(out.authorization).toBe(REDACTED)
    expect(out.cookie).toBe(REDACTED)
    expect(out.backupBody).toBe(REDACTED)
    expect(out.payload).toBe(REDACTED)
    expect(out.api_key).toBe(REDACTED)
    // Booleans cannot carry a secret, so presence flags stay readable.
    expect(out.hasSecretHeader).toBe(true)
    expect(out.userId).toBe('u-1')
  })

  it('bounds long strings, array length and object depth', () => {
    const out = redactLogMeta({
      note: 'x'.repeat(500),
      ids: Array.from({ length: 30 }, (_, i) => i),
    })!
    expect((out.note as string).length).toBeLessThanOrEqual(201)
    expect(out.note as string).toContain('…')
    const ids = out.ids as unknown[]
    expect(ids).toHaveLength(21) // 20 kept + 1 "more" marker
    expect(String(ids[20])).toContain('more')

    let nested: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 10; i++) nested = { child: nested }
    expect(JSON.stringify(redactLogMeta(nested))).toContain('truncated')
  })

  it('applies redaction to every emitted log entry', () => {
    const spy = capture('log')
    logger.info('restore', { token: 'secret-token', backupBody: 'RAW', userId: 'u-1', ok: true })
    const entry = JSON.parse(spy.mock.calls[0][0])
    expect(entry.meta.token).toBe(REDACTED)
    expect(entry.meta.backupBody).toBe(REDACTED)
    expect(entry.meta.ok).toBe(true)
    expect(entry.userId).toBe('u-1')
  })
})

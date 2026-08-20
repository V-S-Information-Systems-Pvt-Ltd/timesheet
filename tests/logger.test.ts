// tests/logger.test.ts
// Tests for the structured logger: requestId/userId promotion to top-level
// fields, extractError normalization, and level gating.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { logger, extractError, setLogLevel } from '../lib/logger'

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

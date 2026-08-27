import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerify, mockFindById, mockActor } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFindById: vi.fn(),
  mockActor: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: mockVerify }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findById: mockFindById } }))
vi.mock('@/lib/auth/mobile-actor', () => ({ getMobileActor: mockActor }))

import { requireMobileActor } from '@/app/api/v1/_http'

const claims = { userId: 'user-1', sessionId: 'session-1', familyId: 'family-1' }
const future = new Date(Date.now() + 30 * 86400 * 1000).toISOString()
const session = {
  userId: 'user-1',
  familyId: 'family-1',
  revokedAt: null,
  rotatedAt: null,
  idleExpiresAt: future,
  absoluteExpiresAt: future,
}
const actor = { id: 'user-1', email: 'u@example.com', isActive: true }

function request(auth?: string): Request {
  return new Request('http://localhost/api/v1/dashboard', {
    headers: auth ? { authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVerify.mockResolvedValue(claims)
  mockFindById.mockResolvedValue(session)
  mockActor.mockResolvedValue(actor)
})

describe('requireMobileActor', () => {
  it('rejects missing or malformed bearer headers', async () => {
    const missing = await requireMobileActor(request())
    const malformed = await requireMobileActor(request('Basic abc'))
    expect(((missing as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(((malformed as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects a revoked or rotated server session', async () => {
    mockFindById.mockResolvedValue({ ...session, rotatedAt: '2026-08-26T10:00:00.000Z' })
    const response = await requireMobileActor(request('Bearer access'))
    expect((response as { response: Response }).response).toBeDefined()
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('rejects an idle-expired session', async () => {
    mockFindById.mockResolvedValue({
      ...session,
      idleExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('rejects an absolute-expired session', async () => {
    mockFindById.mockResolvedValue({
      ...session,
      absoluteExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('resolves the current active actor', async () => {
    const result = await requireMobileActor(request('Bearer access'))
    expect(result).toEqual({ ok: true, actor, sessionId: 'session-1' })
  })
})

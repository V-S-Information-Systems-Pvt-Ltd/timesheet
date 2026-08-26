import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList, mockCreate, mockDelete } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listLeaves: mockList,
    createLeaves: mockCreate,
    deleteLeave: mockDelete,
  },
}))

import { GET, POST } from '@/app/api/v1/leaves/route'
import { DELETE } from '@/app/api/v1/leaves/[id]/route'

const actor = { id: 'user-1', email: 'u@example.com', role: 'user', isActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockList.mockResolvedValue([])
  mockCreate.mockResolvedValue({ error: null })
  mockDelete.mockResolvedValue({ error: null })
})

describe('/api/v1/leaves', () => {
  it('lists leaves for authenticated user on GET', async () => {
    const response = (await GET(
      new Request('http://localhost/api/v1/leaves?from=2026-08-01&to=2026-08-31')
    )) as unknown as { status: number; body: { data: unknown } }

    expect(response.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith(actor, { from: '2026-08-01', to: '2026-08-31' })
  })

  it('creates leave entries on valid POST', async () => {
    const body = {
      rows: [
        {
          userId: 'user-1',
          leaveDate: '2026-08-28',
          reason: 'Medical appointment',
        },
      ],
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(actor, body.rows)
  })

  it('deletes leave on DELETE', async () => {
    const response = (await DELETE(new Request('http://localhost/api/v1/leaves/leaf-1'), {
      params: Promise.resolve({ id: 'leaf-1' }),
    })) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledWith(actor, 'leaf-1')
  })
})

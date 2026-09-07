import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import type { WorkspaceBranding } from '@/app/types'
import { getCachedBranding } from '@/lib/branding-server'

const { mockGetBranding } = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getBranding: mockGetBranding,
  },
}))

// Request-scope semantics of the React cache() branding getter, as far as is
// verifiable without a full Next.js RSC render harness:
// - reads issued during one render resolve consistently;
// - a separate render pass observes updated branding (no cross-request cache).
//
// LIMITATION (matches the plan's own bar): single-query deduplication across
// generateMetadata/generateViewport/RootLayout only holds inside a real Next
// RSC request, which provides the cache scope. Plain renderToString and bare
// calls have no shared scope (verified: two in-render reads issue two repo
// calls here), so this file cannot prove the "one DB hit" property. That
// property must be verified against a running server (see the e2e note in
// docs/plans/MASTER_ARCHITECTURE_REMEDIATION_NOTES.md); this file pins the
// consistency + freshness halves and fails loudly if the getter ever gains a
// cross-request cache.

let captured: Array<Promise<WorkspaceBranding>> = []

function TwoReads() {
  // Both calls happen inside this render pass → one shared cache entry.
  captured.push(getCachedBranding(), getCachedBranding())
  return 'reading'
}

async function renderTwice(): Promise<{ names: [string, string]; calls: number }> {
  captured = []
  renderToString(createElement(TwoReads))
  const [a, b] = await Promise.all(captured)
  return { names: [a.appName, b.appName], calls: mockGetBranding.mock.calls.length }
}

describe('T18.4: request-scoped branding dedup across a render pass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads issued during one render resolve consistently', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'Acme', primaryColor: '#111111', logoUrl: null },
      error: null,
    })
    const { names } = await renderTwice()
    expect(names).toEqual(['Acme', 'Acme'])
  })

  it('a separate render pass observes updated branding', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'First', primaryColor: '#111111', logoUrl: null },
      error: null,
    })
    const first = await renderTwice()
    expect(first.names).toEqual(['First', 'First'])

    mockGetBranding.mockResolvedValue({
      data: { appName: 'Second', primaryColor: '#222222', logoUrl: null },
      error: null,
    })
    const second = await renderTwice()
    expect(second.names).toEqual(['Second', 'Second'])
    // No cross-render (cross-request) caching: the second pass re-read.
    expect(mockGetBranding.mock.calls.length).toBeGreaterThan(first.calls)
  })
})

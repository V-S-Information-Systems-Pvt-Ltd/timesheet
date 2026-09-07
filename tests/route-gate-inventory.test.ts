import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const V1_ROOT = join(process.cwd(), 'app', 'api', 'v1')

// Routes that intentionally do NOT require a mobile bearer session:
// - config: public capability discovery (reports bearerAuth, never issues tokens)
// - cron/cleanup: protected by a dedicated CRON_SECRET, not the bearer switch
const PUBLIC_EXCEPTIONS = new Set([
  join('config', 'route.ts'),
  join('cron', 'cleanup', 'route.ts'),
])

const GATE_MARKERS = [
  'withMobileActor',
  'withMobileSession',
  'requireMobileActor',
  'requireMobileSession',
  'isMobileBearerAuthEnabled',
]

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...routeFiles(full))
    } else if (entry === 'route.ts') {
      out.push(relative(V1_ROOT, full))
    }
  }
  return out.sort()
}

describe('v1 route bearer-gate inventory (T17.3)', () => {
  it('every v1 route is gated or an explicitly listed public exception', () => {
    const files = routeFiles(V1_ROOT)
    expect(files.length).toBeGreaterThan(0)

    const ungated = files.filter((f) => {
      if (PUBLIC_EXCEPTIONS.has(f)) return false
      const src = readFileSync(join(V1_ROOT, f), 'utf8')
      return !GATE_MARKERS.some((m) => src.includes(m))
    })

    expect(ungated).toEqual([])
  })

  it('public exceptions stay narrow and documented', () => {
    // The only intentionally public v1 routes. If this set grows, update
    // deploy/README.md "Public metadata routes" alongside it.
    expect([...PUBLIC_EXCEPTIONS].sort()).toEqual([
      join('config', 'route.ts'),
      join('cron', 'cleanup', 'route.ts'),
    ])

    const cron = readFileSync(join(V1_ROOT, 'cron', 'cleanup', 'route.ts'), 'utf8')
    expect(cron).toContain('CRON_SECRET')
  })
})

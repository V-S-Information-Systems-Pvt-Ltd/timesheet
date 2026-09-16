// tests/boundary-enforcement.test.ts
//
// Static dependency/import boundary guard. These tests scan the current source
// so a regression fails here with an actionable list instead of silently
// re-introducing a forbidden edge. Rules enforced:
//
//   1. Shared packages (`packages/**`) never import Next.js, React, React
//      Native, database clients, application/mobile files, secrets, or a
//      sibling package's private path, and follow core -> contracts -> client.
//   2. Application domains (`lib/domain/**`) never import cookies/headers,
//      Request handlers, a database client, or the global repository dispatch;
//      they depend on ports/adapters instead.
//   3. Browser modules (`app/**` client components, `lib/data/**`,
//      `lib/auth/client.ts`) never import a database client for application
//      data. Provider-specific browser auth (`lib/auth/client.ts`) may still
//      use the Supabase browser client.
//   4. Adapters/services never reach across a different domain's private
//      module.
//
// Documented exceptions: the Supabase provider code under `lib/supabase/**`
// and the server composition modules under `lib/db/*.ts` are the composition
// surfaces these rules route traffic through, so they are not scanned as
// browser/domain modules.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

const SOURCE_EXT = /\.(ts|tsx)$/
const IGNORED_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', 'build'])

function walk(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue
      const full = join(current, entry)
      let isDir: boolean
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) stack.push(full)
      else if (SOURCE_EXT.test(entry)) out.push(full)
    }
  }
  return out
}

function listDir(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((entry) => SOURCE_EXT.test(entry))
    .map((entry) => join(dir, entry))
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

const RE_FROM = /\bfrom\s*['"]([^'"]+)['"]/g
const RE_SIDE_EFFECT = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g
const RE_DYNAMIC = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function importSpecifiers(source: string): string[] {
  const specs = new Set<string>()
  for (const re of [RE_FROM, RE_SIDE_EFFECT, RE_DYNAMIC]) {
    const pattern = new RegExp(re.source, re.flags)
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) specs.add(match[1])
  }
  return [...specs]
}

function stripLeadingComments(source: string): string {
  let out = source
  for (;;) {
    const before = out
    out = out.replace(/^\s+/, '')
    if (out.startsWith('//')) out = out.replace(/^\/\/[^\n]*\n?/, '')
    else if (out.startsWith('/*')) out = out.replace(/^\/\*[\s\S]*?\*\/\s*/, '')
    if (out === before || (!out.startsWith('//') && !out.startsWith('/*'))) break
  }
  return out
}

function isBrowserModule(path: string, source: string): boolean {
  const r = rel(path)
  if (r.startsWith('lib/data/') || r === 'lib/auth/client.ts') return true
  if (!r.startsWith('app/')) return false
  const head = stripLeadingComments(source)
  return head.startsWith("'use client'") || head.startsWith('"use client"')
}

interface Violation {
  file: string
  rule: string
  detail: string
}

function collect(
  files: string[],
  isForbidden: (spec: string, path: string) => string | null
): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const spec of importSpecifiers(source)) {
      const reason = isForbidden(spec, file)
      if (reason) violations.push({ file: rel(file), rule: reason, detail: spec })
    }
  }
  return violations
}

function format(violations: Violation[]): string {
  return violations.map((v) => `  ${v.file}: [${v.rule}] imports "${v.detail}"`).join('\n')
}

const PACKAGE_FILES = walk(join(ROOT, 'packages'))
const DOMAIN_FILES = walk(join(ROOT, 'lib/domain'))
const DB_FILES = listDir(join(ROOT, 'lib/db'))
const APP_FILES = walk(join(ROOT, 'app'))
const DATA_FILES = walk(join(ROOT, 'lib/data'))

const DOMAINS = ['people', 'reference', 'reporting', 'workspace', 'timesheets', 'leave-reminders', 'operations'] as const

function ownsDomain(name: string, spec: string, prefix: string): boolean {
  const match = spec.match(new RegExp(`^${prefix}/([^/]+)$`))
  if (!match) return true
  const target = match[1]
  return target === name || target === `${name}-port` || target === 'write-budget'
}

describe('boundary enforcement', () => {
  it('scans the expected source groups (guards against a mis-pointed scanner)', () => {
    expect(PACKAGE_FILES.length).toBeGreaterThan(0)
    expect(DOMAIN_FILES.length).toBeGreaterThan(0)
    expect(DATA_FILES.length).toBeGreaterThan(0)
    expect(APP_FILES.length).toBeGreaterThan(0)
    // The shared packages and the browser facade exist where the rules expect them.
    expect(PACKAGE_FILES.map(rel)).toContain('packages/core/src/index.ts')
    expect(DATA_FILES.map(rel)).toContain('lib/data/client.ts')
  })

  it('packages never import Next.js, React, React Native, database clients, application/mobile files, or secrets', () => {
    const violations: Violation[] = []
    for (const file of PACKAGE_FILES) {
      const source = readFileSync(file, 'utf8')
      if (/\bprocess\.env\b/.test(source)) {
        violations.push({ file: rel(file), rule: 'packages: no secrets/env', detail: 'process.env' })
      }
      for (const spec of importSpecifiers(source)) {
        let rule: string | null = null
        if (/^next($|\/)/.test(spec)) rule = 'packages: no Next.js'
        else if (/^react($|\/)|^react-native($|\/)|^react-dom($|\/)|^@react-native/.test(spec)) {
          rule = 'packages: no React/React Native'
        } else if (/^@supabase\/|^pg$/.test(spec)) rule = 'packages: no database client'
        else if (/^@\//.test(spec) || /^@\/lib\//.test(spec) || /^(app|lib)\//.test(spec)) {
          rule = 'packages: no application files'
        } else if (/(^|\/)mobile($|\/)/.test(spec)) rule = 'packages: no mobile files'
        else if (/^\.\.\//.test(spec)) rule = 'packages: no parent-directory imports'
        if (rule) violations.push({ file: rel(file), rule, detail: spec })
      }
    }
    expect(format(violations), `Package boundary violations:\n${format(violations)}`).toBe('')
  })

  it('packages follow the core -> contracts -> client dependency direction without private cross-package paths', () => {
    const violations: Violation[] = []
    for (const file of PACKAGE_FILES) {
      const path = rel(file)
      const source = readFileSync(file, 'utf8')
      for (const spec of importSpecifiers(source)) {
        if (/^@vsis\/[^/]+\/.+/.test(spec)) {
          violations.push({ file: path, rule: 'packages: public export only', detail: spec })
          continue
        }
        if (path.startsWith('packages/core/') && /^@vsis\/(contracts|client)$/.test(spec)) {
          violations.push({ file: path, rule: 'core cannot depend on contracts/client', detail: spec })
        }
        if (path.startsWith('packages/contracts/') && spec === '@vsis/client') {
          violations.push({ file: path, rule: 'contracts cannot depend on client', detail: spec })
        }
      }
    }
    expect(format(violations), `Package direction violations:\n${format(violations)}`).toBe('')
  })

  it('application domains never import cookies/headers, a database client, or the global repository dispatch', () => {
    const forbidden = (spec: string): string | null => {
      if (spec === '@/lib/db') return 'domain: no global repository dispatch'
      if (/^@\/lib\/db\/(native|supabase|pool)$/.test(spec)) return 'domain: no provider client'
      if (new RegExp(`^@/lib/db/(${DOMAINS.join('|')})$`).test(spec)) {
        return 'domain: use a port, not a sibling adapter'
      }
      if (/^next\/(headers|server)$/.test(spec)) return 'domain: no cookies/headers/Request'
      if (spec.startsWith('@supabase/') || spec === 'pg') return 'domain: no database client'
      if (spec.startsWith('@/lib/supabase/')) return 'domain: no supabase provider'
      return null
    }
    const violations = collect(DOMAIN_FILES, forbidden)
    expect(format(violations), `Domain boundary violations:\n${format(violations)}`).toBe('')
  })

  it('browser modules never import a database client for application data', () => {
    const browserFiles = [...APP_FILES, ...DATA_FILES, join(ROOT, 'lib/auth/client.ts')].filter((file) =>
      isBrowserModule(file, readFileSync(file, 'utf8'))
    )
    expect(browserFiles.length).toBeGreaterThan(0)

    const forbidden = (spec: string, file: string): string | null => {
      const isBrowserClient = spec === '@/lib/supabase/client'
      const authFacade = rel(file) === 'lib/auth/client.ts'
      if (spec === '@/lib/db' || /^@\/lib\/db\/(native|supabase|pool)$/.test(spec)) {
        return 'browser: no database client'
      }
      if (new RegExp(`^@/lib/db/(${DOMAINS.join('|')})$`).test(spec)) {
        return 'browser: no database adapter'
      }
      if (spec.startsWith('@/lib/supabase/server') || spec.startsWith('@supabase/') || spec === 'pg') {
        return 'browser: no database client'
      }
      // Provider-specific browser authentication stays behind the auth facade.
      if (isBrowserClient && !authFacade) return 'browser: no database client'
      return null
    }
    const violations = collect(browserFiles, forbidden)
    expect(format(violations), `Browser boundary violations:\n${format(violations)}`).toBe('')
  })

  it('adapters and services do not reach across a different domain private module', () => {
    const adapterViolations: Violation[] = []
    for (const file of DB_FILES) {
      const name = rel(file).replace(/^lib\/db\//, '').replace(/\.ts$/, '')
      if (!DOMAINS.includes(name as (typeof DOMAINS)[number])) continue
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('@/lib/domain/') && !ownsDomain(name, spec, '@/lib/domain')) {
          adapterViolations.push({ file: rel(file), rule: 'adapter: cross-domain import', detail: spec })
        }
      }
    }

    const serviceViolations: Violation[] = []
    for (const file of DOMAIN_FILES) {
      const name = rel(file).replace(/^lib\/domain\//, '').replace(/\.ts$/, '')
      if (!DOMAINS.includes(name as (typeof DOMAINS)[number])) continue
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (/^\.\/[^/]+$/.test(spec) && !ownsDomain(name, spec, '.')) {
          serviceViolations.push({ file: rel(file), rule: 'service: cross-domain import', detail: spec })
        }
      }
    }

    const violations = [...adapterViolations, ...serviceViolations]
    expect(format(violations), `Cross-domain violations:\n${format(violations)}`).toBe('')
  })
})

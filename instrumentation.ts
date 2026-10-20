// instrumentation.ts
// Next.js server initialization hook. Runs once on server startup before serving requests.

export async function register() {
  // Build evaluation (phase-production-build) must never refuse to boot on
  // missing runtime env: proxy hops and bearer secrets are runtime concerns.
  // Only log there; enforce at actual server startup.
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
  if (process.env.NEXT_RUNTIME === 'nodejs' && !isBuildPhase) {
    const { validateProxyConfiguration } = await import('./lib/ip')
    const result = validateProxyConfiguration()
    if (!result.ok) {
      throw new Error(`[Startup Validation Failed] ${result.error}`)
    }
    if (result.warning) {
      console.warn(`[Startup Warning] ${result.warning}`)
    }

    // A missing or still-placeholder signing key means sessions can be forged
    // with a publicly known value: refuse to serve rather than run open.
    if (process.env.NODE_ENV === 'production') {
      const { secretProblem } = await import('./lib/secret-env')
      for (const name of ['AUTH_SECRET', 'RATE_LIMIT_SUBJECT_SECRET']) {
        const problem = secretProblem(name, process.env[name])
        if (problem) throw new Error(`[Startup Validation Failed] ${problem}`)
      }
    }

    // Fail-closed bearer-config check at startup (T17.3): when the flag is
    // explicitly enabled but the backend-specific key material is missing or
    // malformed, log once so the misconfiguration is visible in deploy logs.
    // Request paths still enforce the same predicate per request (503
    // MOBILE_API_DISABLED), so a late-added env var cannot silently open auth.
    try {
      const { isMobileBearerAuthEnabled, describeMobileBearerConfig } = await import('./lib/auth/mobile-config')
      if (process.env.MOBILE_BEARER_AUTH_ENABLED?.trim() === 'true' && !isMobileBearerAuthEnabled()) {
        console.warn(`[Startup Warning] Mobile bearer auth is enabled but misconfigured: ${describeMobileBearerConfig()}`)
      }
    } catch {
      // Non-fatal: per-request enforcement remains authoritative.
    }
  }
}

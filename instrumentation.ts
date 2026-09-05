// instrumentation.ts
// Next.js server initialization hook. Runs once on server startup before serving requests.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateProxyConfiguration } = await import('./lib/ip')
    const result = validateProxyConfiguration()
    if (!result.ok) {
      throw new Error(`[Startup Validation Failed] ${result.error}`)
    }
    if (result.warning) {
      console.warn(`[Startup Warning] ${result.warning}`)
    }
  }
}

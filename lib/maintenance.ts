import 'server-only'

/** Read per request: this flag must not be frozen into a build or module cache. */
export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === 'true'
}

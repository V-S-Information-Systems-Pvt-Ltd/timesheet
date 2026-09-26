// lib/migration/connections.ts
// Explicit, allowlisted connection configuration for the operator CLI.
//
// Rules enforced here (C01 task 2 and 4):
//   * the provider must be an allowlisted identifier;
//   * connection material is only ever read from an explicitly named env var
//     whose name starts with MIGRATION_ — the CLI never falls back to
//     DATABASE_URL, NEXT_PUBLIC_*, the build-time backend selector or the
//     application pool;
//   * secrets never appear in argv, results or journals;
//   * a Supabase Auth endpoint must belong to the same project as the
//     PostgreSQL connection before any Auth mutation is attempted.

import { PROVIDER_NAMES, type ProviderName } from './format'

export type ConnectionRole = 'source' | 'destination'

export class MigrationConfigError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MigrationConfigError'
    this.code = code
  }
}

export const MIGRATION_ENV_NAME_RE = /^MIGRATION_[A-Z0-9_]+$/

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export interface ResolvedDatabaseTarget {
  provider: ProviderName
  role: ConnectionRole
  envName: string
  connectionString: string
  /** Non-secret operator-facing identity of the endpoint. */
  displayTarget: string
  loopback: boolean
  projectRef: string | null
  applicationName: string
}

export interface ResolvedAuthTarget {
  role: ConnectionRole
  urlEnvName: string
  keyEnvName: string
  url: string
  serviceKey: string
  loopback: boolean
  projectRef: string | null
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

export function assertProviderName(provider: string): ProviderName {
  if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) {
    throw new MigrationConfigError(
      'E_PROVIDER_UNKNOWN',
      `Unknown provider "${provider}". Allowed providers: ${PROVIDER_NAMES.join(', ')}.`
    )
  }
  return provider as ProviderName
}

function readEnvName(envName: string, env: Record<string, string | undefined>): { name: string; value: string } {
  if (!MIGRATION_ENV_NAME_RE.test(envName)) {
    throw new MigrationConfigError(
      'E_ENV_NAME_INVALID',
      `Environment variable name "${envName}" is not allowed: connection inputs must be explicitly named MIGRATION_* variables.`
    )
  }
  const value = env[envName]
  if (value === undefined || value.trim() === '') {
    throw new MigrationConfigError('E_ENV_MISSING', `Environment variable ${envName} is not set.`)
  }
  return { name: envName, value }
}

export interface ParsedPostgresUrl {
  hostname: string
  port: string
  database: string
  user: string
  loopback: boolean
  projectRef: string | null
}

export function parsePostgresUrl(raw: string): ParsedPostgresUrl {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new MigrationConfigError('E_ENV_NOT_POSTGRES_URL', 'Database connection value is not a valid URL.')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new MigrationConfigError(
      'E_ENV_NOT_POSTGRES_URL',
      `Database connection value must use postgres:// or postgresql://, found "${url.protocol}"`
    )
  }
  const database = url.pathname.replace(/^\//, '')
  if (database.length === 0) {
    throw new MigrationConfigError('E_ENV_NOT_POSTGRES_URL', 'Database connection URL does not name a database.')
  }
  const hostname = url.hostname
  const user = decodeURIComponent(url.username)
  return {
    hostname,
    port: url.port || '5432',
    database,
    user,
    loopback: isLoopbackHost(hostname),
    projectRef: supabaseProjectRefFromParts(hostname, user),
  }
}

/** Project ref from a Supabase database endpoint (direct host or pooler user). */
export function supabaseProjectRefFromParts(hostname: string, user: string): string | null {
  const host = hostname.toLowerCase()
  const dbHost = /^db\.([a-z0-9-]+)\.supabase\.co$/.exec(host)
  if (dbHost) return dbHost[1]
  const directHost = /^([a-z0-9-]+)\.supabase\.(co|net|in)$/.exec(host)
  if (directHost && directHost[1] !== 'db') return directHost[1]
  const poolerUser = /^postgres\.([a-z0-9-]+)$/.exec(user)
  if (poolerUser) return poolerUser[1]
  return null
}

export interface ParsedAuthUrl {
  url: string
  loopback: boolean
  projectRef: string | null
}

export function parseSupabaseAuthUrl(raw: string): ParsedAuthUrl {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new MigrationConfigError('E_ENV_NOT_HTTP_URL', 'Supabase Auth URL is not a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MigrationConfigError('E_ENV_NOT_HTTP_URL', 'Supabase Auth URL must use http:// or https://.')
  }
  const host = url.hostname.toLowerCase()
  const match = /^([a-z0-9-]+)\.supabase\.(co|net|in)$/.exec(host)
  return {
    url: url.origin,
    loopback: isLoopbackHost(host),
    projectRef: match ? match[1] : null,
  }
}

export function resolveDatabaseTarget(input: {
  provider: string
  role: ConnectionRole
  envName: string
  env: Record<string, string | undefined>
}): ResolvedDatabaseTarget {
  const provider = assertProviderName(input.provider)
  const { name, value } = readEnvName(input.envName, input.env)
  const parsed = parsePostgresUrl(value)
  return {
    provider,
    role: input.role,
    envName: name,
    connectionString: value,
    displayTarget: `${parsed.hostname}:${parsed.port}/${parsed.database}`,
    loopback: parsed.loopback,
    projectRef: parsed.projectRef,
    applicationName: `vsis-migration-${input.role}`,
  }
}

export function resolveAuthTarget(input: {
  role: ConnectionRole
  urlEnvName: string
  keyEnvName: string
  env: Record<string, string | undefined>
}): ResolvedAuthTarget {
  const url = readEnvName(input.urlEnvName, input.env)
  const key = readEnvName(input.keyEnvName, input.env)
  const parsed = parseSupabaseAuthUrl(url.value)
  return {
    role: input.role,
    urlEnvName: url.name,
    keyEnvName: key.name,
    url: parsed.url,
    serviceKey: key.value,
    loopback: parsed.loopback,
    projectRef: parsed.projectRef,
  }
}

export interface InstanceBindingFacts {
  projectRef: string | null
  loopback: boolean
}

/**
 * Bind a Supabase Auth endpoint to the PostgreSQL connection it will mutate.
 * Rejects swapped credentials and endpoints that identify a different project
 * before any Auth mutation can happen.
 */
export function assertAuthDatabaseBinding(db: InstanceBindingFacts, auth: InstanceBindingFacts): void {
  if (db.projectRef && auth.projectRef) {
    if (db.projectRef !== auth.projectRef) {
      throw new MigrationConfigError(
        'E_AUTH_DB_MISMATCH',
        `Supabase Auth endpoint belongs to project "${auth.projectRef}" but the database belongs to "${db.projectRef}".`
      )
    }
    return
  }
  if (db.projectRef && !auth.projectRef) {
    throw new MigrationConfigError(
      'E_AUTH_DB_MISMATCH',
      `Database identifies Supabase project "${db.projectRef}" but the Auth endpoint does not identify the same project.`
    )
  }
  if (!db.projectRef && auth.projectRef) {
    throw new MigrationConfigError(
      'E_AUTH_DB_MISMATCH',
      `Supabase Auth endpoint identifies project "${auth.projectRef}" but the database endpoint does not.`
    )
  }
  if (!db.loopback || !auth.loopback) {
    throw new MigrationConfigError(
      'E_AUTH_DB_UNVERIFIED',
      'Neither endpoint carries a Supabase project identifier and they are not both local; refusing to bind Auth to this database.'
    )
  }
}

// tools/migration/src/providers/native.ts
// Native-provider inspection: read-only identity, catalog, counts and the
// applied-migration ledger, plus the provider-consistency guard that refuses a
// Supabase project presented as a native deployment.

import { ENTITY_ORDER } from '../format'
import type { CatalogInspection } from '../schema'
import { MigrationRunError } from '../journal'
import type { DatabaseIdentity, DatabaseSession } from './session'

export interface InstanceInspection {
  identity: DatabaseIdentity
  catalog: CatalogInspection
  counts: Record<string, number>
  missingTables: string[]
  appliedMigrations: string[]
}

export function assertNativeCatalog(catalog: CatalogInspection): void {
  if (catalog.hasAuthSchema || catalog.hasSupabaseMigrationLedger) {
    throw new MigrationRunError(
      'E_PROVIDER_MISMATCH',
      'Provider "native" points at a Supabase project (auth schema present). Refusing to continue with swapped provider identifiers.'
    )
  }
}

export function assertSupabaseCatalog(catalog: CatalogInspection): void {
  if (!catalog.hasAuthSchema) {
    throw new MigrationRunError(
      'E_PROVIDER_MISMATCH',
      'Provider "supabase" points at a database without a Supabase auth schema. Refusing to continue with swapped provider identifiers.'
    )
  }
}

export async function inspectInstance(session: DatabaseSession): Promise<InstanceInspection> {
  const identity = await session.identity()
  const catalog = await session.inspectCatalog()
  if (identity.provider === 'native') assertNativeCatalog(catalog)
  else assertSupabaseCatalog(catalog)

  const counts: Record<string, number> = {}
  const missingTables: string[] = []
  for (const entity of ENTITY_ORDER) {
    if (!catalog.tables.includes(entity)) {
      missingTables.push(entity)
      continue
    }
    counts[entity] = await session.countRows(entity)
  }

  const appliedMigrations = await session.migrationLedger()

  return { identity, catalog, counts, missingTables, appliedMigrations }
}

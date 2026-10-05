import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  adaptLegacyRow, canonicalizeRow, canonicalRowLine, canonicalStringify, LEGACY_ENTITY_SPECS,
  MIGRATION_FORMAT_VERSION, MigrationFormatError,
} from '../src/format'
import { LEGACY_PROVIDER_SCHEMA_FINGERPRINTS, PROVIDER_SCHEMA_FINGERPRINTS } from '../src/schema'
import { validateBundleDirectory } from '../src/validation'
import { projectRow, timesheetRow, writeBundleFixture } from './helpers/migration-fixtures'

describe('migration classification format', () => {
  it('exports an expanded v2 schema and distinct legacy fingerprints', () => {
    expect(MIGRATION_FORMAT_VERSION).toBe(2)
    expect(PROVIDER_SCHEMA_FINGERPRINTS.native).not.toBe(LEGACY_PROVIDER_SCHEMA_FINGERPRINTS.native)
    expect(PROVIDER_SCHEMA_FINGERPRINTS.supabase).not.toBe(LEGACY_PROVIDER_SCHEMA_FINGERPRINTS.supabase)
    expect(canonicalizeRow('projects', projectRow()).is_timesheet_project).toBe(false)
    expect(canonicalizeRow('timesheets', timesheetRow({ project_id: null, entry_type: 'internal', activity_code: 'meetings' })).project_id).toBeNull()
  })

  it('rejects invalid classification rows at the trust boundary', () => {
    expect(() => canonicalizeRow('timesheets', timesheetRow({ entry_type: 'support', activity_code: 'customers', project_id: null, ticket_number: 'T-1' }))).not.toThrow()
    for (const patch of [
      { project_id: null },
      { entry_type: 'support', activity_code: 'customers', project_id: null },
      { entry_type: 'internal', activity_code: 'other', project_id: null, activity_other: null },
      { entry_type: null, activity_code: 'testing' },
    ]) expect(() => canonicalizeRow('timesheets', timesheetRow(patch))).toThrow(MigrationFormatError)
  })

  it('reads v1 through its exact legacy adapter and preserves duplicate keys', async () => {
    const legacyProject = { ...projectRow() } as Record<string, unknown>
    delete legacyProject.is_timesheet_project
    const legacyTimesheet = { ...timesheetRow() } as Record<string, unknown>
    for (const key of ['entry_type', 'activity_code', 'activity_other', 'ticket_number']) delete legacyTimesheet[key]
    const versioned = LEGACY_ENTITY_SPECS.timesheets.columns.map(c => c.name).join(',')
    expect(versioned).not.toContain('entry_type')
    const canonical = canonicalizeRow('timesheets', legacyTimesheet, 1)
    expect(canonical.project_id).toBe(legacyTimesheet.project_id)
    const adapted = adaptLegacyRow('timesheets', canonical)
    expect(adapted).toMatchObject({ entry_type: null, activity_code: null })
    expect(canonicalStringify(canonicalizeRow('projects', legacyProject, 1))).not.toContain('is_timesheet_project')

    const directory = join(tmpdir(), `vsis-v1-${Math.random().toString(36).slice(2)}`)
    writeBundleFixture(directory, { formatVersion: 1, rows: { projects: [legacyProject], timesheets: [legacyTimesheet] } })
    const result = await validateBundleDirectory(directory)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    rmSync(directory, { recursive: true, force: true })
  })

  it('v1 and v2 lines differ; v1 rows adapt instead of reclassifying', () => {
    const legacyProject = { ...projectRow() } as Record<string, unknown>
    delete legacyProject.is_timesheet_project
    expect(canonicalRowLine('projects', legacyProject, 1)).not.toContain('is_timesheet_project')
    expect(adaptLegacyRow('projects', canonicalizeRow('projects', legacyProject, 1)).is_timesheet_project).toBe(false)
    const legacyRow = { ...timesheetRow({ project_id: null }) } as Record<string, unknown>
    for (const key of ['entry_type', 'activity_code', 'activity_other', 'ticket_number']) delete legacyRow[key]
    expect(() => canonicalizeRow('timesheets', legacyRow, 1)).toThrow(/non-nullable/i)
  })
})

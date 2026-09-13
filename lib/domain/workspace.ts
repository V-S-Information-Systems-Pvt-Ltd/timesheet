import 'server-only'

import { DEFAULT_BRANDING, validateBranding } from '@/lib/branding'
import { ADMIN_TILE_IDS, TILE_IDS } from '@/app/constants'
import { getActorCapabilities, isSuperAdminActor, type ActorCapabilities } from '@/lib/roles'
import { DEFAULT_MOBILE_LAYOUT, resolveMobileLayout, sanitizeMobileLayout } from '@/lib/layout'
import type {
  AdminDashboardLayout,
  DashboardLayout,
  MobileLayout,
  WorkspaceBranding,
} from '@/app/types'
import type { Actor, DefaultLayouts } from '@/lib/db/repository'
import type { BackfillSettings } from '@/lib/validation'
import type { WorkspacePersistence } from './workspace-port'

/**
 * Explicit dependencies for the workspace application module: a narrow
 * persistence port. Transports compose this at the server entry boundary; the
 * module never resolves a global repository, cookies, or headers.
 */
export interface WorkspaceDomainDeps {
  persistence: WorkspacePersistence
}

export type WorkspaceErrorCode = 'FORBIDDEN' | 'VALIDATION_ERROR' | 'STORAGE_ERROR'

export interface WorkspaceDomainError {
  code: WorkspaceErrorCode
  message: string
  /** Present for VALIDATION_ERROR so transports can render per-field errors. */
  fieldErrors?: Record<string, string>
}

export type WorkspaceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: WorkspaceDomainError }

/**
 * Defense-in-depth active-account guard. Transport boundaries already reject
 * inactive actors, but the domain must not proceed for a direct caller holding
 * an inactive Actor either.
 */
function inactiveActorError(actor: Actor): WorkspaceDomainError | null {
  if (!actor.isActive) {
    return { code: 'FORBIDDEN', message: 'Your account is not active.' }
  }
  return null
}

function forbidden(message: string): WorkspaceDomainError {
  return { code: 'FORBIDDEN', message }
}

function storageError(message: string): WorkspaceDomainError {
  return { code: 'STORAGE_ERROR', message }
}

function validationError(message: string, fieldErrors?: Record<string, string>): WorkspaceDomainError {
  return { code: 'VALIDATION_ERROR', message, fieldErrors }
}

// ---------------------------------------------------------------------------
// App settings: backfill window
// ---------------------------------------------------------------------------

/** Shared backfill-window shape validation (transport-independent). */
function validateBackfillSettings(settings: BackfillSettings): string | null {
  if (settings.mode !== 'days' && settings.mode !== 'month_start') {
    return 'Invalid backfill mode.'
  }
  if (!Number.isInteger(settings.windowDays) || settings.windowDays < 0 || settings.windowDays > 365) {
    return 'Days window must be a whole number between 0 and 365.'
  }
  if (!Number.isInteger(settings.extraDays) || settings.extraDays < 0 || settings.extraDays > 365) {
    return 'Extra days must be a whole number between 0 and 365.'
  }
  return null
}

/** Any active signed-in user may read the effective backfill window. */
export async function getBackfillSettings(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<BackfillSettings>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const settings = await deps.persistence.getBackfillWindow(actor)
  return { ok: true, data: settings }
}

/** Admin-only view used by the admin backfill settings endpoint. */
export async function getAdminBackfillSettings(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<BackfillSettings>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (actor.permission_role !== 'admin') {
    return { ok: false, error: forbidden('Only administrators can view backfill settings.') }
  }
  const settings = await deps.persistence.getBackfillWindow(actor)
  return { ok: true, data: settings }
}

/** Admin-only write with shared shape validation. */
export async function setBackfillSettings(
  actor: Actor,
  settings: BackfillSettings,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<BackfillSettings>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (actor.permission_role !== 'admin') {
    return { ok: false, error: forbidden('Only administrators can update backfill settings.') }
  }
  const invalid = validateBackfillSettings(settings)
  if (invalid) return { ok: false, error: validationError(invalid) }
  const result = await deps.persistence.setBackfillWindow(actor, settings)
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: settings }
}

// ---------------------------------------------------------------------------
// Panel layouts (web dashboard / admin panel)
// ---------------------------------------------------------------------------

function tilesAreValid(
  tiles: { id: string; enabled: boolean }[] | undefined,
  allowed: readonly string[]
): boolean {
  const known = new Set<string>(allowed)
  const seen = new Set<string>()
  return (
    Array.isArray(tiles) &&
    tiles.length === known.size &&
    tiles.every(
      (t) =>
        !!t &&
        known.has(t.id) &&
        !seen.has(t.id) &&
        typeof t.enabled === 'boolean' &&
        (seen.add(t.id), true)
    )
  )
}

/** Read the global default panel order (any active signed-in user). */
export async function getDefaultLayouts(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<DefaultLayouts>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const result = await deps.persistence.getDefaultLayouts(actor)
  if (result.error || !result.data) {
    return {
      ok: false,
      error: storageError(result.error ?? 'Could not load default panel layouts.'),
    }
  }
  return { ok: true, data: result.data }
}

/** Save the calling user's dashboard tile order/visibility, validating the tile set. */
export async function saveDashboardLayout(
  actor: Actor,
  layout: DashboardLayout,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<null>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (!tilesAreValid(layout?.tiles, TILE_IDS)) {
    return { ok: false, error: validationError('Invalid layout.') }
  }
  const result = await deps.persistence.setDashboardLayout(actor, layout)
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: null }
}

/**
 * Save the calling admin's admin-panel tile layout. The Super Admin tile is
 * reserved for the configured super-admin: it is stripped from the payload for
 * everyone else so it never reaches the database.
 */
export async function saveAdminLayout(
  actor: Actor,
  layout: AdminDashboardLayout,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<null>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (actor.permission_role !== 'admin') {
    return { ok: false, error: forbidden('You do not have permission to perform this action.') }
  }
  const allowed = isSuperAdminActor(actor)
    ? ADMIN_TILE_IDS
    : ADMIN_TILE_IDS.filter((id) => id !== 'super-admin')
  const tiles = (layout?.tiles ?? []).filter((t) => !!t && (allowed as string[]).includes(t.id))
  if (!tilesAreValid(tiles, allowed)) {
    return { ok: false, error: validationError('Invalid layout.') }
  }
  const result = await deps.persistence.setAdminLayout(actor, { tiles })
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: null }
}

/**
 * Super-admin: persist the global default panel order (dashboard, admin and the
 * optional mobile default), owning the tile-set validation for all three.
 */
export async function saveDefaultLayouts(
  actor: Actor,
  layouts: DefaultLayouts,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<null>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (!isSuperAdminActor(actor)) {
    return { ok: false, error: forbidden('You do not have permission to perform this action.') }
  }
  if (!tilesAreValid(layouts.dashboard?.tiles, TILE_IDS)) {
    return { ok: false, error: validationError('Invalid dashboard layout.') }
  }
  if (!tilesAreValid(layouts.admin?.tiles, ADMIN_TILE_IDS)) {
    return { ok: false, error: validationError('Invalid admin layout.') }
  }
  const result = await deps.persistence.setDefaultLayouts(actor, layouts)
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: null }
}

// ---------------------------------------------------------------------------
// Mobile module layouts
// ---------------------------------------------------------------------------
export interface MobileLayoutState {
  /** Effective layout after precedence, essential-module and capability gates. */
  layout: MobileLayout
  savedLayout: MobileLayout | null
  defaultLayout: MobileLayout
  capabilities: ActorCapabilities
}

async function readDefaultMobileLayout(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<{ ok: true; layout: MobileLayout } | { ok: false; error: WorkspaceDomainError }> {
  const defRes = await deps.persistence.getDefaultLayouts(actor)
  if (defRes.error) return { ok: false, error: storageError(defRes.error) }
  return { ok: true, layout: defRes.data?.mobile ?? DEFAULT_MOBILE_LAYOUT }
}

/**
 * Resolve the caller's effective mobile layout: stored override first, workspace
 * default second, registry default last, then essential-module and capability
 * gates (both role axes) for the caller.
 */
export async function getMobileLayoutState(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<MobileLayoutState>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const [savedRes, defRes] = await Promise.all([
    deps.persistence.getMobileLayout(actor),
    deps.persistence.getDefaultLayouts(actor),
  ])
  if (savedRes.error || defRes.error) {
    return { ok: false, error: storageError(savedRes.error ?? defRes.error ?? 'Could not load layout.') }
  }

  const capabilities = getActorCapabilities(actor)
  const defaultLayout = defRes.data?.mobile ?? DEFAULT_MOBILE_LAYOUT
  const effectiveLayout = resolveMobileLayout(savedRes.data, defaultLayout, capabilities)
  return {
    ok: true,
    data: {
      layout: effectiveLayout,
      savedLayout: savedRes.data,
      defaultLayout,
      capabilities,
    },
  }
}

export interface SavedMobileLayout {
  layout: MobileLayout
  savedLayout: MobileLayout
}

/** Sanitize against the workspace default and persist the caller's override. */
export async function saveMobileLayout(
  actor: Actor,
  layout: unknown,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<SavedMobileLayout>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const defaults = await readDefaultMobileLayout(actor, deps)
  if (!defaults.ok) return { ok: false, error: defaults.error }

  const sanitized = sanitizeMobileLayout(layout, defaults.layout)
  if (!sanitized) {
    return { ok: false, error: validationError('Failed to sanitize layout.') }
  }

  const writeRes = await deps.persistence.setMobileLayout(actor, sanitized)
  if (writeRes.error) return { ok: false, error: storageError(writeRes.error) }

  const capabilities = getActorCapabilities(actor)
  return {
    ok: true,
    data: {
      layout: resolveMobileLayout(sanitized, defaults.layout, capabilities),
      savedLayout: sanitized,
    },
  }
}

/** Clear the caller's override so the workspace default applies again. */
export async function resetMobileLayout(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<{ layout: MobileLayout; savedLayout: null }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const defaults = await readDefaultMobileLayout(actor, deps)
  if (!defaults.ok) return { ok: false, error: defaults.error }

  const writeRes = await deps.persistence.setMobileLayout(actor, null)
  if (writeRes.error) return { ok: false, error: storageError(writeRes.error) }

  const capabilities = getActorCapabilities(actor)
  return {
    ok: true,
    data: {
      layout: resolveMobileLayout(null, defaults.layout, capabilities),
      savedLayout: null,
    },
  }
}

/** Read the workspace default mobile layout (any active user). */
export async function getDefaultMobileLayout(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<{ layout: MobileLayout }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const defaults = await readDefaultMobileLayout(actor, deps)
  if (!defaults.ok) return { ok: false, error: defaults.error }
  return { ok: true, data: { layout: defaults.layout } }
}

/**
 * Super-admin: replace the workspace default mobile layout, preserving the
 * stored dashboard/admin defaults (they are unrelated to this endpoint).
 */
export async function saveDefaultMobileLayout(
  actor: Actor,
  layout: unknown,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<{ layout: MobileLayout }>> {
  const denied = requireSuperAdmin(actor)
  if (denied) return { ok: false, error: denied }

  const defRes = await deps.persistence.getDefaultLayouts(actor)
  if (defRes.error) return { ok: false, error: storageError(defRes.error) }
  const current = defRes.data

  const sanitized = sanitizeMobileLayout(layout, DEFAULT_MOBILE_LAYOUT)
  if (!sanitized) {
    return { ok: false, error: validationError('Failed to sanitize layout.') }
  }

  const writeRes = await deps.persistence.setDefaultLayouts(actor, {
    dashboard: current?.dashboard ?? { tiles: [] },
    admin: current?.admin ?? { tiles: [] },
    mobile: sanitized,
  })
  if (writeRes.error) return { ok: false, error: storageError(writeRes.error) }
  return { ok: true, data: { layout: sanitized } }
}

/** Super-admin: clear the workspace default mobile override (registry default applies). */
export async function resetDefaultMobileLayout(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<{ layout: MobileLayout }>> {
  const denied = requireSuperAdmin(actor)
  if (denied) return { ok: false, error: denied }

  const defRes = await deps.persistence.getDefaultLayouts(actor)
  if (defRes.error) return { ok: false, error: storageError(defRes.error) }
  const current = defRes.data

  const writeRes = await deps.persistence.setDefaultLayouts(actor, {
    dashboard: current?.dashboard ?? { tiles: [] },
    admin: current?.admin ?? { tiles: [] },
    mobile: null,
  })
  if (writeRes.error) return { ok: false, error: storageError(writeRes.error) }
  return { ok: true, data: { layout: DEFAULT_MOBILE_LAYOUT } }
}

function requireSuperAdmin(actor: Actor): WorkspaceDomainError | null {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!isSuperAdminActor(actor)) {
    return forbidden('Only super-administrators can update workspace default layouts.')
  }
  return null
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

interface BrandingRead {
  branding: WorkspaceBranding
  error: string | null
}

/**
 * Read branding with the safe fallback used everywhere: a missing row, a
 * provider error, or a thrown exception all resolve to the compiled defaults so
 * rendering never fails. `actor` is optional because layout/metadata rendering
 * reads branding for unauthenticated visitors too.
 */
async function readBranding(actor: Actor | undefined, deps: WorkspaceDomainDeps): Promise<BrandingRead> {
  try {
    const res = await deps.persistence.getBranding(actor)
    return { branding: res.data ?? DEFAULT_BRANDING, error: res.error ?? null }
  } catch (err) {
    return {
      branding: DEFAULT_BRANDING,
      error: err instanceof Error ? err.message : 'Failed to load branding.',
    }
  }
}

/** Branding read for an active signed-in user (Server Action surface). */
export async function getWorkspaceBranding(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<WorkspaceBranding>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const { branding, error } = await readBranding(actor, deps)
  if (error) return { ok: false, error: storageError(error) }
  return { ok: true, data: branding }
}

/** Super-admin branding read (versioned admin endpoint surface). */
export async function getAdminWorkspaceBranding(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<WorkspaceBranding>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (!isSuperAdminActor(actor)) {
    return { ok: false, error: forbidden('Super-admin access required.') }
  }
  const { branding, error } = await readBranding(actor, deps)
  if (error) return { ok: false, error: storageError(error) }
  return { ok: true, data: branding }
}

/**
 * Platform-safe branding accessor: never throws, always returns usable
 * branding. Used by the request-scoped React cache and public config endpoint.
 */
export async function getBrandingOrDefault(deps: WorkspaceDomainDeps): Promise<WorkspaceBranding> {
  const { branding } = await readBranding(undefined, deps)
  return branding
}

/** Super-admin: validate and persist branding. */
export async function saveWorkspaceBranding(
  actor: Actor,
  input: unknown,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<WorkspaceBranding>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (!isSuperAdminActor(actor)) {
    return { ok: false, error: forbidden('Super-admin access required.') }
  }
  const validation = validateBranding(input)
  if (!validation.valid || !validation.data) {
    return {
      ok: false,
      error: validationError('Invalid workspace branding settings.', validation.errors),
    }
  }
  const result = await deps.persistence.setBranding(actor, validation.data)
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: validation.data }
}

/** Super-admin: reset branding to the compiled defaults. */
export async function resetWorkspaceBranding(
  actor: Actor,
  deps: WorkspaceDomainDeps
): Promise<WorkspaceResult<WorkspaceBranding>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  if (!isSuperAdminActor(actor)) {
    return { ok: false, error: forbidden('Super-admin access required.') }
  }
  const result = await deps.persistence.setBranding(actor, DEFAULT_BRANDING)
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: DEFAULT_BRANDING }
}

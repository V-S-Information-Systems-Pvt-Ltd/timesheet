// app/actions/projects.ts
// Server Actions for project management operations.
'use server'

import { referenceDeps } from '@/lib/db/reference'
import {
  createProject,
  deleteProject as deleteProjectDomain,
  renameProject as renameProjectDomain,
  setProjectSO as setProjectSODomain,
  setProjectTelegramNo as setProjectTelegramNoDomain,
  type ReferenceResult,
} from '@/lib/domain/reference'
import { type ActionResult, requireActor } from './_shared'

/**
 * Project reference-data actions. The active-actor and admin/pm gate stays at
 * the Server Action boundary; payload validation and orchestration are owned by
 * the reference application service (`lib/domain/reference.ts`), which enforces
 * the same policy as defense in depth.
 */
function toActionResult(result: ReferenceResult<unknown>): ActionResult {
  return result.ok ? {} : { error: result.error.message }
}

export async function addProject(name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await createProject(gate.actor, { name }, referenceDeps())
  return toActionResult(result)
}

export async function renameProject(projectId: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await renameProjectDomain(gate.actor, projectId, name, referenceDeps())
  return toActionResult(result)
}

export async function setProjectSO(projectId: string, soNumber: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await setProjectSODomain(gate.actor, projectId, soNumber, referenceDeps())
  return toActionResult(result)
}

/** Admin/pm: set (or clear) the Telegram bot number for a project. */
export async function setProjectTelegramNo(
  projectId: string,
  telegramNo: number | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await setProjectTelegramNoDomain(gate.actor, projectId, telegramNo, referenceDeps())
  return toActionResult(result)
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await deleteProjectDomain(gate.actor, projectId, referenceDeps())
  return toActionResult(result)
}

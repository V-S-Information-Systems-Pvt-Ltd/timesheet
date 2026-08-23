// app/actions/projects.ts
// Server Actions for project management operations.
'use server'

import { isNonEmpty } from '@/lib/validation'
import { repo } from '@/lib/db'
import { type ActionResult, requireActor } from './_shared'

export async function addProject(name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Project name is required.' }

  const result = await repo.createProject(gate.actor, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function renameProject(projectId: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Project name is required.' }

  const result = await repo.renameProject(gate.actor, projectId, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function setProjectSO(projectId: string, soNumber: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.setProjectSO(gate.actor, projectId, soNumber.trim() || null)
  return result.error ? { error: result.error } : {}
}

/** Admin/pm: set (or clear) the Telegram bot number for a project. */
export async function setProjectTelegramNo(
  projectId: string,
  telegramNo: number | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }
  if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
    return { error: 'Bot number must be a positive whole number.' }
  }

  const result = await repo.setProjectTelegramNo(gate.actor, projectId, telegramNo)
  return result.error ? { error: result.error } : {}
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.deleteProject(gate.actor, projectId)
  return result.error ? { error: result.error } : {}
}

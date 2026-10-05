import 'server-only'

import type { Actor } from '@/lib/db/types'
import { operationsPersistence } from '@/lib/db/operations'
import { extractError, logger } from '@/lib/logger'

/** Best-effort audit logging shared by actions and HTTP coordinators. */
export async function safeAudit(
  actor: Actor,
  entry: { action: string; targetId?: string; detail?: Record<string, unknown> }
): Promise<void> {
  try {
    await operationsPersistence.writeAuditLog(actor, entry)
  } catch (err) {
    logger.error('audit log write failed', { action: entry.action, error: extractError(err) })
  }
}

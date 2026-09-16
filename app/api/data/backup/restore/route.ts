// app/api/data/backup/restore/route.ts
// Dedicated authenticated Route Handler for large backup JSON restores (up to 20 MB).
// Bypasses the 1 MB Next.js Server Action body limit with explicit streaming bounds and CSRF checks.

import { json, originCheck, requireActive, serverError } from '@/app/api/_http'
import { operationsDeps } from '@/lib/db/operations'
import { restoreBackupFromJson } from '@/lib/domain/operations'
import { isAdminActor } from '@/lib/roles'

const MAX_RESTORE_BODY_BYTES = 20 * 1024 * 1024 // 20 MB

const AUDIT_RECORD_FAILED_MESSAGE =
  'Restore committed, but the audit record could not be written. Re-run the restore report or record this operation manually.'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  const auth = await requireActive(request)
  if (!auth.ok) return auth.response
  const actor = auth.actor

  if (!isAdminActor(actor)) {
    return json({ error: 'You do not have permission to perform this action.' }, 403)
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_RESTORE_BODY_BYTES) {
    return json({ error: 'Backup file is too large (max 20 MB).' }, 413)
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return json({ error: 'Failed to read backup payload.' }, 400)
  }

  if (!text || text.trim().length === 0) {
    return json({ error: 'No backup file provided.' }, 400)
  }

  if (text.length > MAX_RESTORE_BODY_BYTES) {
    return json({ error: 'Backup file is too large (max 20 MB).' }, 413)
  }

  try {
    // Parse, validate and atomically restore via the operations coordinator: the
    // whole restore is one provider transaction (native txn / restore_backup_tx
    // RPC), so a validation or mid-write failure reports no fabricated counts.
    // Audit delivery stays outside the restore: a committed restore with a failed
    // audit is reported separately (auditRecorded/auditError) rather than a 500.
    const outcome = await restoreBackupFromJson(actor, text, operationsDeps())
    if (!outcome.ok) {
      const status = outcome.error.code === 'FORBIDDEN' ? 403 : 400
      return json({ error: outcome.error.message }, status)
    }

    const { created, skipped, auditRecorded } = outcome.data
    return json({
      success: true,
      created,
      skipped,
      auditRecorded,
      ...(auditRecorded ? {} : { auditError: AUDIT_RECORD_FAILED_MESSAGE }),
    })
  } catch (err) {
    return serverError(err)
  }
}

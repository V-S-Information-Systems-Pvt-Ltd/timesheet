import { json, serverError, withMobileActor } from '@/app/api/v1/_http'
import { operationsDeps } from '@/lib/db/operations'
import { restoreBackupFromJson } from '@/lib/domain/operations'
import { isAdminActor } from '@/lib/roles'

export const runtime = 'nodejs'

const MAX_RESTORE_BODY_BYTES = 20 * 1024 * 1024 // 20 MB

const AUDIT_RECORD_FAILED_MESSAGE =
  'Restore committed, but the audit record could not be written. Re-run the restore report or record this operation manually.'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
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
  }, { allowCookie: true })
}

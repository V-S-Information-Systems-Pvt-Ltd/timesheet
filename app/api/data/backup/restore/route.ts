// app/api/data/backup/restore/route.ts
// Dedicated authenticated Route Handler for large backup JSON restores (up to 20 MB).
// Bypasses the 1 MB Next.js Server Action body limit with explicit streaming bounds and CSRF checks.

import { json, originCheck, requireActive, serverError } from '@/app/api/_http'
import { parseBackup } from '@/lib/backup'
import { repo } from '@/lib/db'
import { isAdminActor } from '@/lib/roles'
import { safeAudit } from '@/app/actions/_shared'

const MAX_RESTORE_BODY_BYTES = 20 * 1024 * 1024 // 20 MB

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

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return json({ error: 'Invalid backup file (not valid JSON).' }, 400)
  }

  const check = parseBackup(parsed)
  if (!check.ok || !check.payload) {
    return json({ error: check.error ?? 'Invalid backup file.' }, 400)
  }

  try {
    const result = await repo.restoreBackup(actor, check.payload)
    if (result.error) {
      return json({ error: result.error }, 400)
    }

    await safeAudit(actor, {
      action: 'backup.restore',
      detail: { created: result.created, skipped: result.skipped },
    })

    return json({
      success: true,
      created: result.created,
      skipped: result.skipped,
    })
  } catch (err) {
    return serverError(err)
  }
}

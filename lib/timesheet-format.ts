import 'server-only'

/** Enable only after paired migrations and compatible clients are deployed. */
export function isTimesheetClassificationV2Enabled(): boolean {
  return process.env.TIMESHEET_CLASSIFICATION_V2 === 'true'
}

export function timesheetFormatResponse(request: Request): Response | null {
  // Browser routes rely on cookies and same-origin Server Action transports that
  // cannot inject the explicit format header. The compatibility gate is for
  // bearer/mobile clients; web flows receive classification fields through their
  // established server actions and stay format-compatible by construction.
  if (!request.headers.get('authorization')) return null
  if (!isTimesheetClassificationV2Enabled() || request.headers.get('x-timesheet-format') === '2') return null
  return Response.json({
    data: null,
    error: { code: 'CLIENT_UPDATE_REQUIRED', message: 'Update your client to use Type and Activity timesheets.' },
  }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
}

/** These reads carry full timesheets, not merely format-independent totals. */
export function isTimesheetBearingRead(request: Request): boolean {
  const path = new URL(request.url).pathname
  return /\/api\/(?:v1|data)\/(?:timesheets(?:\/|$)|dashboard(?:\/|$)|reports\/export(?:\/|$)|admin\/backup$|admin\/users\/[^/]+\/timesheets(?:\/|$))/.test(path)
}

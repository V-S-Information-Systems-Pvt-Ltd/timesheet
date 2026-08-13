// app/api/health/route.ts
// Liveness/readiness probe endpoint for container platforms (OpenShift/Rancher).
// Deliberately does not touch the database so it works during startup.

import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json({ status: 'ok' })
}

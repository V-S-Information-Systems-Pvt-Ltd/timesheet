// app/api/health/live/route.ts
// Lightweight process liveness probe endpoint for Kubernetes / OpenShift / Rancher.
// Returns 200 without dependency calls so deadlocks or DB outages do not trigger
// restart storms on healthy application processes.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}

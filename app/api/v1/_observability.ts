import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

export type RouteHandler = (request: Request) => Promise<Response>

/**
 * Hardening (WP-07): request-scoped observability for the mobile API.
 *
 * - Stamps every response with an `X-Request-Id` header clients can quote.
 * - Emits one structured access-log line per request.
 * - Never logs bodies, query strings, emails, or credential material.
 *
 * Wrapping keeps the underlying handler signature unchanged, so Server Action
 * parity and existing tests are untouched.
 */
export function withRequestLogging(route: string, handler: RouteHandler): RouteHandler {
  return async (request: Request) => {
    const requestId = randomUUID()
    const startedAt = Date.now()
    let response: Response
    try {
      response = await handler(request)
    } catch (err) {
      // Handlers normally convert errors themselves; this is the backstop so
      // an unexpected failure still carries the request id.
      writeLog(requestId, route, request.method, 500, Date.now() - startedAt)
      throw err
    }

    // Route tests substitute plain-object response doubles for NextResponse;
    // pass those through untouched so assertions keep working. Production
    // handlers always return real Response instances.
    if (!(response instanceof Response)) return response

    const headers = new Headers(response.headers)
    headers.set('X-Request-Id', requestId)
    writeLog(requestId, route, request.method, response.status, Date.now() - startedAt)
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

function writeLog(
  requestId: string,
  route: string,
  method: string,
  status: number,
  durationMs: number,
): void {
  // Single-line structured event; safe fields only. Correlate sessions by the
  // access-token `sid` claim stored on mobile_sessions, never by token values.
  const line = JSON.stringify({ requestId, route, method, status, durationMs })
  if (status >= 500) console.error(line)
  else console.info(line)
}

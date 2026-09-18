// Platform-neutral HTTP transport core shared by web and mobile. It owns
// request construction, base-URL joining, JSON envelope parsing, error mapping
// and single-flight 401 refresh-retry coordination. Authentication is injected
// through callbacks, so no platform fetch, storage or session state lives here.
import type { ApiResult } from '@vsis/contracts'

export type { ApiErrorBody, ApiResult } from '@vsis/contracts'

/** Minimal fetch surface, so callers can inject a platform fetch or a stub. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Returns the bearer token to authenticate a request, or `null`/`undefined`. */
export type GetAuth = () => string | null | undefined | Promise<string | null | undefined>

/** Obtains a replacement access token after a 401 so the request can retry once. */
export type RefreshAuth = () => Promise<string | null | undefined> | string | null | undefined

/** Runs when a request fails with an unrecoverable 401. */
export type OnUnauthorized = () => void | Promise<void>

export interface ApiClientOptions {
  baseUrl: string
  fetch?: FetchLike
  getAuth?: GetAuth
  refresh?: RefreshAuth
  onUnauthorized?: OnUnauthorized
  timeoutMs?: number
}

/** Result of a raw JSON transport call that does not use the `{ data, error }` envelope. */
export interface ApiTransportResponse<T = unknown> {
  status: number
  ok: boolean
  /** Parsed JSON body; `null` when the body was empty or not valid JSON. */
  body: T
}

export class ApiClientError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    const extractedMessage =
      body && typeof body === 'object' && 'error' in body && (body as { error?: { message?: string } }).error?.message
        ? (body as { error: { message: string } }).error.message
        : `API request failed with status ${status}.`
    super(extractedMessage)
    this.name = 'ApiClientError'
    this.status = status
    this.body = body
  }

  get code(): string | undefined {
    if (this.body && typeof this.body === 'object' && 'error' in this.body) {
      return (this.body as { error?: { code?: string } }).error?.code
    }
    return undefined
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('An API base URL is required.')
  return normalized
}

/**
 * Perform a JSON fetch with an abortable timeout and return both the response
 * and its parsed body. A failed JSON parse yields `body === undefined`, which
 * callers distinguish from a valid `null` body.
 */
async function fetchJson(
  fetcher: FetchLike,
  url: string,
  init: RequestInit | undefined,
  authToken: string | undefined,
  timeoutMs: number
): Promise<{ response: Response; body: unknown }> {
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  let response: Response
  try {
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController()
    }

    const pending = fetcher(url, {
      ...init,
      signal: controller?.signal ?? init?.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    })

    // React Native Windows may leave a fetch pending after AbortController
    // fires while the device is offline. Race it with an explicit rejection
    // so callers can persist an idempotent mutation instead of leaving the
    // submit UI in its loading state indefinitely.
    const timeout = new Promise<Response>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        const error = new Error(`Request timed out after ${timeoutMs}ms.`)
        error.name = 'TimeoutError'
        reject(error)
      }, timeoutMs)
    })

    response = await Promise.race([pending, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  return { response, body }
}

export interface ApiClientCore {
  readonly baseUrl: string
  /** Wires or clears the refresh callback used for the single-flight 401 retry. */
  setRefreshHandler(handler: RefreshAuth | undefined): void
  request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<ApiResult<T>>
  unwrap<T>(result: ApiResult<T>, status: number): T
  /**
   * Low-level JSON transport for compatibility endpoints that return a bare
   * body instead of the strict `{ data, error }` envelope. It still joins the
   * base URL, injects authentication and applies the request timeout, so all
   * HTTP traffic shares one transport implementation.
   */
  send<T = unknown>(path: string, init?: RequestInit): Promise<ApiTransportResponse<T>>
}

export function createApiClient(options: ApiClientOptions): ApiClientCore {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetcher: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 15000
  const getAuth = options.getAuth
  let refreshHandler = options.refresh

  async function resolveAuth(accessToken?: string): Promise<string | undefined> {
    if (accessToken) return accessToken
    if (!getAuth) return undefined
    return (await getAuth()) ?? undefined
  }

  async function request<T>(
    path: string,
    init?: RequestInit,
    accessToken?: string,
    isRetry = false
  ): Promise<ApiResult<T>> {
    const authToken = await resolveAuth(accessToken)

    const { response, body: parsedBody } = await fetchJson(
      fetcher,
      `${baseUrl}${path}`,
      init,
      authToken,
      timeoutMs
    )

    // Single-flight 401 retry when a refresh callback is wired and the request
    // carried an access token.
    if (response.status === 401 && authToken && !isRetry && refreshHandler) {
      try {
        const nextAccessToken = await refreshHandler()
        return request<T>(path, init, nextAccessToken ?? undefined, true)
      } catch {
        // Refresh failed, fall through to throw the original 401.
      }
    }

    const body =
      parsedBody === undefined
        ? { data: null, error: { message: 'The server returned an invalid response.' } }
        : parsedBody

    if (!response.ok) {
      if (response.status === 401) await options.onUnauthorized?.()
      throw new ApiClientError(response.status, body)
    }

    if (!body || typeof body !== 'object' || !('data' in body) || !('error' in body)) {
      throw new ApiClientError(response.status, body)
    }

    const result = body as ApiResult<T>
    if (result.error) throw new ApiClientError(response.status, result)
    return result
  }

  async function send<T = unknown>(path: string, init?: RequestInit): Promise<ApiTransportResponse<T>> {
    const authToken = await resolveAuth(undefined)
    const { response, body } = await fetchJson(fetcher, `${baseUrl}${path}`, init, authToken, timeoutMs)
    return {
      status: response.status,
      ok: response.ok,
      body: (body === undefined ? null : body) as T,
    }
  }

  function unwrap<T>(result: ApiResult<T>, status: number): T {
    if (result.error || result.data === null) throw new ApiClientError(status, result)
    return result.data
  }

  return {
    baseUrl,
    setRefreshHandler(handler) {
      refreshHandler = handler
    },
    request,
    unwrap,
    send,
  }
}

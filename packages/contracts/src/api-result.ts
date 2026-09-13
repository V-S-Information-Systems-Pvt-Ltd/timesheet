// Canonical HTTP response envelope shared by the server transports and every
// platform-neutral client. A payload is either `{ data, error: null }` on
// success or `{ data: null, error }` on failure, so callers branch on `error`.

/** Structured error body returned by the versioned API envelope. */
export interface ApiErrorBody {
  code?: string
  message: string
  fieldErrors?: Record<string, string[]>
}

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: ApiErrorBody }

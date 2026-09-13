// Public surface of @vsis/client: the platform-neutral HTTP transport and the
// types callers need to build a client on top of an injected fetch, base URL
// and authentication behavior.
export {
  ApiClientError,
  createApiClient,
  type ApiClientCore,
  type ApiClientOptions,
  type ApiTransportResponse,
  type FetchLike,
  type GetAuth,
  type OnUnauthorized,
  type RefreshAuth,
} from './api-client'

export type { ApiErrorBody, ApiResult } from '@vsis/contracts'

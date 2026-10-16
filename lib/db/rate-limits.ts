import 'server-only'

import type { RateLimitStore } from '@/lib/rate-limit'
import { nativeOperationsPersistence } from './native/operations'

const operations = nativeOperationsPersistence

/** Select the narrow provider adapter without loading the broad Repository facade. */
export const rateLimitStore: RateLimitStore = {
  reserve: (input) => operations.reserveRateLimit(input),
  release: (input) => operations.releaseRateLimit(input),
}

import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import type { RateLimitStore } from '@/lib/rate-limit'
import { nativeOperationsPersistence } from './native/operations'
import { supabaseOperationsPersistence } from './supabase/operations'

const operations = IS_NATIVE
  ? nativeOperationsPersistence
  : supabaseOperationsPersistence

/** Select the narrow provider adapter without loading the broad Repository facade. */
export const rateLimitStore: RateLimitStore = {
  reserve: (input) => operations.reserveRateLimit(input),
  release: (input) => operations.releaseRateLimit(input),
}

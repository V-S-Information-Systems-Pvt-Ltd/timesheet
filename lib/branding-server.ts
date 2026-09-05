// lib/branding-server.ts
import 'server-only'
import { cache } from 'react'
import { repo } from '@/lib/db'
import { DEFAULT_BRANDING, type BrandingConfig } from '@/lib/branding'

/**
 * Request-scoped deduplicated branding getter using React cache().
 * Deduplicates calls across generateMetadata, generateViewport, and RootLayout within the same request.
 */
export const getCachedBranding = cache(async (): Promise<BrandingConfig> => {
  try {
    const res = await repo.getBranding()
    return res.data ?? DEFAULT_BRANDING
  } catch {
    return DEFAULT_BRANDING
  }
})

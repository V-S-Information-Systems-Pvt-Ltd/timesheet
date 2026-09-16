// lib/branding-server.ts
import 'server-only'
import { cache } from 'react'
import { workspaceDeps } from '@/lib/db/workspace'
import { getBrandingOrDefault } from '@/lib/domain/workspace'
import type { WorkspaceBranding } from '@/app/types'

/**
 * Request-scoped deduplicated branding getter using React cache().
 * Deduplicates calls across generateMetadata, generateViewport, and RootLayout
 * within the same request. Branding policy (defaults, normalization, and the
 * safe failure fallback) is owned by the workspace application service; this
 * module only memoizes the platform-neutral read per request, so no database
 * client, rendering, or storage concern leaks into the shared boundary.
 */
export const getCachedBranding = cache(async (): Promise<WorkspaceBranding> =>
  getBrandingOrDefault(workspaceDeps())
)

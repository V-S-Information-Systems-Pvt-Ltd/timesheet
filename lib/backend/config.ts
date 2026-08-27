// lib/backend/config.ts
// Shared backend-mode resolution. `NEXT_PUBLIC_BACKEND` is a single source of
// truth for both server and client so they always select the same adapter.

export type Backend = 'supabase' | 'native'

export const BACKENDS: readonly Backend[] = ['supabase', 'native'] as const

export function resolveBackend(value: string | undefined): Backend {
  const normalized = value?.trim()
  if (!normalized) return 'supabase'
  if (normalized === 'supabase' || normalized === 'native') return normalized
  throw new Error(
    `Invalid NEXT_PUBLIC_BACKEND "${value}". Expected one of: ${BACKENDS.join(', ')}.`
  )
}

export const BACKEND: Backend = resolveBackend(process.env.NEXT_PUBLIC_BACKEND)

export const IS_SUPABASE = BACKEND === 'supabase'
export const IS_NATIVE = BACKEND === 'native'

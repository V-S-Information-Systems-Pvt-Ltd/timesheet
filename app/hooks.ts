// app/hooks.ts
// Shared client-side data hooks.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type FetcherResult<T> = Promise<{ data: T | null; error: { message: string } | null }>

/**
 * Runs an async fetcher on mount (and whenever `deps` change) with a
 * stale-response guard, exposing the result plus a `reload()` helper.
 * De-duplicates the "fetch on mount + refetch after mutation" pattern used
 * by the dashboard panels.
 */
export function useAsyncData<T>(fetcher: () => FetcherResult<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const fetcherRef = useRef(fetcher)
  // Keep the ref in sync with the latest fetcher outside of render.
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const run = useCallback(async (isReload: boolean) => {
    if (isReload) setReloading(true)
    const { data: result, error: err } = await fetcherRef.current()
    setData(result)
    setError(err ? err.message : null)
    setReloading(false)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: result, error: err } = await fetcherRef.current()
      if (active) {
        setData(result)
        setError(err ? err.message : null)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const reload = useCallback(() => run(true), [run])

  return { data, error, reloading, reload }
}

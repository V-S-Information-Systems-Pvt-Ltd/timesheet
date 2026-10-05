import { Suspense } from 'react'
import { LoadingState } from '@/app/components/ui'
import { getDashboardSeed } from '@/lib/dashboard-seed-server'
import DashboardClient from './dashboard-client'

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') search.set(key, value)
    else if (value?.[0]) search.set(key, value[0])
  }
  const seed = await getDashboardSeed(search)
  return <Suspense fallback={<LoadingState fullscreen />}><DashboardClient seed={seed} /></Suspense>
}

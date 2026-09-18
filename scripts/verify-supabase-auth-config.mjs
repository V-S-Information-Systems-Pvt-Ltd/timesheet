// Build/deployment gate for public Supabase registration.
//
// The Auth endpoint is public by design, so application-route cleanup cannot
// compensate for hosted email autoconfirm. Every Supabase production build
// verifies the provider setting before emitting deployable assets.

import { pathToFileURL } from 'node:url'

export function validateSupabaseAuthSettings(settings) {
  const failures = []
  if (settings?.disable_signup === true) failures.push('email signup is disabled')
  if (settings?.external?.email !== true) failures.push('the email provider is disabled')
  if (settings?.mailer_autoconfirm !== false) failures.push('email ownership confirmation is disabled')
  return failures
}

export async function verifySupabaseAuthConfig({ env = process.env, fetchImpl = fetch } = {}) {
  const backend = (env.NEXT_PUBLIC_BACKEND || 'supabase').trim().toLowerCase()
  if (backend === 'native') {
    return { skipped: true, reason: 'native backend' }
  }
  if (env.SUPABASE_AUTH_CONFIG_CHECK === 'skip') {
    return { skipped: true, reason: 'explicit compile-only bypass' }
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Supabase builds require NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for the Auth configuration gate.')
  }

  const response = await fetchImpl(`${url}/auth/v1/settings`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) {
    throw new Error(`Unable to verify Supabase Auth settings (HTTP ${response.status}).`)
  }

  const settings = await response.json()
  const failures = validateSupabaseAuthSettings(settings)
  if (failures.length > 0) {
    throw new Error(`Unsafe Supabase Auth configuration: ${failures.join('; ')}.`)
  }
  return { skipped: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifySupabaseAuthConfig()
    if (result.skipped) {
      console.log(`Supabase Auth configuration gate skipped: ${result.reason}.`)
    } else {
      console.log('Supabase Auth configuration verified: email signup requires ownership confirmation.')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

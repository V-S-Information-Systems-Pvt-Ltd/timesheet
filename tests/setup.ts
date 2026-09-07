// tests/setup.ts
// Global vitest setup. `loadEnvConfig` in vitest.config.mts loads .env.local,
// which in CI does not exist, so the rate-limit subject secret would be missing
// and every reserve call would throw. Set a deterministic test value here so the
// HMAC path is exercised (rather than mocked away) with stable digests.
process.env.RATE_LIMIT_SUBJECT_SECRET = process.env.RATE_LIMIT_SUBJECT_SECRET ?? 'vitest-rate-limit-subject-secret-0000000000000'
process.env.MOBILE_BEARER_AUTH_ENABLED = process.env.MOBILE_BEARER_AUTH_ENABLED ?? 'true'
process.env.MOBILE_AUTH_SECRET = process.env.MOBILE_AUTH_SECRET ?? '01234567890123456789012345678901'
process.env.SUPABASE_MOBILE_SIGNING_KEY = process.env.SUPABASE_MOBILE_SIGNING_KEY ?? 'supabase-mobile-signing-key-0123456789012345'
process.env.SUPABASE_MOBILE_SIGNING_KEY_ID = process.env.SUPABASE_MOBILE_SIGNING_KEY_ID ?? 'test-key-id-1'
process.env.SUPABASE_MOBILE_SIGNING_ALG = process.env.SUPABASE_MOBILE_SIGNING_ALG ?? 'HS256'
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://test-project.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'test-anon-key-0123456789'

if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
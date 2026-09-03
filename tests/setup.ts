// tests/setup.ts
// Global vitest setup. `loadEnvConfig` in vitest.config.mts loads .env.local,
// which in CI does not exist, so the rate-limit subject secret would be missing
// and every reserve call would throw. Set a deterministic test value here so the
// HMAC path is exercised (rather than mocked away) with stable digests.
process.env.RATE_LIMIT_SUBJECT_SECRET = process.env.RATE_LIMIT_SUBJECT_SECRET ?? 'vitest-rate-limit-subject-secret-0000000000000'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/helpers.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      // CP12 coverage gate: expanded to lib/**, app/api/**, and app/actions.ts.
      // Generated database types are excluded.
      // Aggregate thresholds match sustained levels across the expanded scope;
      // per-file thresholds ensure key security, auth, rate-limit, and data
      // modules cannot regress behind aggregate numbers.
      include: [
        'lib/**',
        'app/api/**',
        'app/actions.ts',
      ],
      exclude: ['lib/supabase/database.types.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50,
        'lib/auth/jwt.ts': {
          lines: 95,
          functions: 95,
          statements: 90,
          branches: 75,
        },
        'lib/auth/password.ts': {
          lines: 90,
          functions: 95,
          statements: 85,
          branches: 85,
        },
        'lib/auth/client.ts': {
          lines: 60,
          functions: 60,
          statements: 60,
          branches: 50,
        },
        'lib/rate-limit.ts': {
          lines: 85,
          functions: 80,
          statements: 85,
          branches: 75,
        },
        'lib/validation.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 90,
        },
        'lib/data/client.ts': {
          lines: 95,
          functions: 95,
          statements: 90,
          branches: 65,
        },
        'app/actions.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 90,
        },
      },
    },
  },
})

import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

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
    coverage: {
      provider: 'v8',
      // Phase 1 acceptance (>60% on lib/ and app/actions.ts) scoped to the
      // modules §1.3 targets with new unit tests. The DB/Supabase repository
      // adapters (lib/db/*, lib/supabase/*) are out of the Phase 1 test scope
      // and are tracked separately.
      include: [
        'lib/validation.ts',
        'lib/auth/client.ts',
        'lib/backend/config.ts',
        'lib/data/client.ts',
        'app/actions.ts',
      ],
      exclude: ['lib/supabase/database.types.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50,
      },
    },
  },
})

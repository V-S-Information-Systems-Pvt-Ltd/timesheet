import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const migrationRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      '@': repoRoot,
      '@vsis/migration-tool': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('../../tests/helpers.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['migrations/tool/tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['migrations/tool/src/**'],
      reporter: ['text', 'lcov'],
      reportsDirectory: fileURLToPath(new URL('./coverage', import.meta.url)),
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50,
      },
    },
  },
  cacheDir: `${migrationRoot}/node_modules/.vitest`,
})

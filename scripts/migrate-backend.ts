// scripts/migrate-backend.ts
// Thin operator entry point for the backend migration tool:
//   npm run migration -- <validate|inspect|preflight> [flags]
//
// All behavior lives in lib/migration/cli.ts so it can be tested without
// spawning a process. This file only wires process argv/stdio/exit code.

import { runCli } from '../lib/migration/cli'

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
)

// db/migrate.ts
// Standalone CLI: apply native migrations against DATABASE_URL.
//
//   npm run db:migrate
//
// The web server also applies migrations automatically on startup in native
// mode; this script exists for CI and operator use before/around deploys.

import { Pool } from 'pg'
import { runMigrations } from '../lib/db/migrate'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')

  const pool = new Pool({ connectionString: url })
  try {
    const applied = await runMigrations(pool)
    console.log(
      applied.length
        ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
        : 'No pending migrations.'
    )
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

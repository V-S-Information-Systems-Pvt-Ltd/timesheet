// db/seed.mjs
// Self-contained first-admin provisioner for the native backend.
//
// Runs with plain Node (no build tooling) so it works inside the minimal
// runtime container image: `node db/seed.mjs`. It applies pending migrations
// with advisory locking & checksums and then upserts an active admin.
//
// Mirrors lib/db/migrate.ts and lib/auth/password.ts in plain JS so the
// runtime image does not need tsx or the TypeScript source.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'

const scrypt = promisify(scryptCallback)
const MIGRATION_ADVISORY_LOCK_ID = 8675309

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 })
  return `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`
}

function validatePasswordPolicy(pwd, label) {
  if (typeof pwd !== 'string' || pwd.length < 8) {
    throw new Error(`${label} must be at least 8 characters.`)
  }
  if (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd) || !/[0-9]/.test(pwd)) {
    throw new Error(`${label} must contain at least one uppercase letter, one lowercase letter, and one digit.`)
  }
}

function computeChecksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

async function runMigrations(pool) {
  const lockClient = await pool.connect()
  try {
    await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID])

    await lockClient.query(
      `create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now(),
        checksum text
      );
      alter table public.schema_migrations add column if not exists checksum text;`
    )
    const { rows } = await lockClient.query('select name, checksum from public.schema_migrations')
    const appliedMap = new Map(rows.map((r) => [r.name, r.checksum]))
    const dir = process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'db', 'migrations')

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(path.join(dir, file), 'utf8')
      const checksum = computeChecksum(sql)

      if (appliedMap.has(file)) {
        const recorded = appliedMap.get(file)
        if (recorded && recorded !== checksum) {
          throw new Error(
            `Migration checksum mismatch for "${file}". Recorded: ${recorded}, Computed: ${checksum}.`
          )
        }
        if (!recorded) {
          await lockClient.query(
            'update public.schema_migrations set checksum = $1 where name = $2',
            [checksum, file]
          )
        }
        continue
      }

      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into public.schema_migrations (name, checksum) values ($1, $2)', [file, checksum])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw err
      } finally {
        client.release()
      }
    }
  } finally {
    try {
      await lockClient.query('select pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID])
    } catch {
      // ignore unlock error on disconnect
    }
    lockClient.release()
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  // Optional: a second account that gets super-admin powers in the app
  // (identified by SUPER_ADMIN_EMAIL). Provisioned as an active admin.
  const superEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase()
  const superPassword = process.env.SUPER_ADMIN_PASSWORD || ''

  if (!url) throw new Error('DATABASE_URL is not set.')
  if (!email) throw new Error('ADMIN_EMAIL is not set.')
  validatePasswordPolicy(password, 'ADMIN_PASSWORD')

  const pool = new pg.Pool({ connectionString: url })
  try {
    await runMigrations(pool)
    const passwordHash = await hashPassword(password)
    await pool.query(
      `insert into public.profiles (email, name, role, is_active, password_hash)
       values ($1, $1, 'admin', true, $2)
       on conflict (email)
       do update set role = 'admin', is_active = true, password_hash = excluded.password_hash`,
      [email, passwordHash]
    )
    console.log(`Admin provisioned: ${email}`)

    if (superEmail && superEmail !== email) {
      validatePasswordPolicy(superPassword, 'SUPER_ADMIN_PASSWORD')
      const superHash = await hashPassword(superPassword)
      await pool.query(
        `insert into public.profiles (email, name, role, is_active, password_hash)
         values ($1, $1, 'admin', true, $2)
         on conflict (email)
         do update set role = 'admin', is_active = true, password_hash = excluded.password_hash`,
        [superEmail, superHash]
      )
      console.log(`Super-admin provisioned: ${superEmail}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

// db/seed.mjs
// Self-contained first-admin provisioner for the native backend.
//
// Runs with plain Node (no build tooling) so it works inside the minimal
// runtime container image: `node db/seed.mjs`. Migration application is shared
// with the TypeScript runner via db/migrate-runner.mjs (advisory locking &
// checksums); this script then upserts an active admin.
//
// Password hashing mirrors lib/auth/password.ts in plain JS so the runtime
// image does not need tsx or the TypeScript source.

import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'
import { runMigrations } from './migrate-runner.mjs'

const scrypt = promisify(scryptCallback)

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
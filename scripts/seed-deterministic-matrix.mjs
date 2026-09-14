// scripts/seed-deterministic-matrix.mjs
// Deterministic test data generator for CI dual-backend matrix & E2E release gates.
//
// Provisions test users covering all permission roles (admin, pm, co, user)
// and hierarchy roles (manager, team_lead, engineer, user), active and deactivated
// status, reporting structures, whitelisted domains, and standard reference records.

import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'

const scrypt = promisify(scryptCallback)

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 })
  return `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`
}

export const MATRIX_PASSWORD = process.env.MATRIX_PASSWORD || 'MatrixPassword123!'

export const DETERMINISTIC_USERS = [
  {
    email: 'admin@vsis.lk',
    name: 'Admin User',
    permission_role: 'admin',
    hierarchy_role: 'manager',
    isActive: true,
  },
  {
    email: 'pm@vsis.lk',
    name: 'Project Manager',
    permission_role: 'pm',
    hierarchy_role: 'manager',
    isActive: true,
  },
  {
    email: 'co@vsis.lk',
    name: 'Coordinator User',
    permission_role: 'co',
    hierarchy_role: 'manager',
    isActive: true,
  },
  {
    email: 'manager@vsis.lk',
    name: 'Engineering Manager',
    permission_role: 'user',
    hierarchy_role: 'manager',
    isActive: true,
  },
  {
    email: 'lead@vsis.lk',
    name: 'Team Lead',
    permission_role: 'user',
    hierarchy_role: 'team_lead',
    managerEmail: 'manager@vsis.lk',
    isActive: true,
  },
  {
    email: 'engineer@vsis.lk',
    name: 'Staff Engineer',
    permission_role: 'user',
    hierarchy_role: 'engineer',
    managerEmail: 'manager@vsis.lk',
    teamLeadEmail: 'lead@vsis.lk',
    isActive: true,
  },
  {
    email: 'user@vsis.lk',
    name: 'Standard Employee',
    permission_role: 'user',
    hierarchy_role: 'user',
    isActive: true,
  },
  {
    email: 'deactivated@vsis.lk',
    name: 'Deactivated User',
    permission_role: 'user',
    hierarchy_role: 'user',
    isActive: false,
  },
]

export async function seedMatrix(dbUrl) {
  const pool = new pg.Pool({ connectionString: dbUrl })
  try {
    const defaultPasswordHash = await hashPassword(MATRIX_PASSWORD)

    // 1. Whitelisted domain
    await pool.query(
      `insert into public.whitelisted_domains (domain, auto_activate)
       values ('vsis.lk', true)
       on conflict (domain) do update set auto_activate = true`
    )

    // 2. Reference projects
    await pool.query(
      `insert into public.projects (name, so_number, telegram_no)
       values ('Internal', 'SO-001', 1000)
       on conflict (name) do update set so_number = excluded.so_number`
    )

    // 3. Activity types
    const activityTypes = ['R&D', 'Meeting', 'Certification', 'Presales support', 'Documentation']
    for (const name of activityTypes) {
      await pool.query(
        `insert into public.activity_types (name, is_active)
         values ($1, true)
         on conflict (name) do update set is_active = true`,
        [name]
      )
    }

    // 4. Upsert users in two passes (first profiles, then reporting hierarchy)
    const userIdsByEmail = new Map()

    for (const u of DETERMINISTIC_USERS) {
      const res = await pool.query(
        `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active, password_hash)
         values ($1, $2, $3, $3, $4, $5, $6)
         on conflict (email)
         do update set
           name = excluded.name,
           role = excluded.role,
           permission_role = excluded.permission_role,
           hierarchy_role = excluded.hierarchy_role,
           is_active = excluded.is_active,
           password_hash = excluded.password_hash
         returning id, email`,
        [u.email, u.name, u.permission_role, u.hierarchy_role, u.isActive, defaultPasswordHash]
      )
      if (res.rows[0]) {
        userIdsByEmail.set(res.rows[0].email.toLowerCase(), res.rows[0].id)
      }
    }

    // Pass 2: managers and team leads
    for (const u of DETERMINISTIC_USERS) {
      const userId = userIdsByEmail.get(u.email.toLowerCase())
      const managerId = u.managerEmail ? userIdsByEmail.get(u.managerEmail.toLowerCase()) ?? null : null
      const teamLeadId = u.teamLeadEmail ? userIdsByEmail.get(u.teamLeadEmail.toLowerCase()) ?? null : null

      if (userId && (managerId || teamLeadId)) {
        await pool.query(
          `update public.profiles
           set manager_id = $1, team_lead_id = $2
           where id = $3`,
          [managerId, teamLeadId, userId]
        )
      }
    }

    console.log(`Successfully seeded ${DETERMINISTIC_USERS.length} matrix users into database.`)
    return { userCount: DETERMINISTIC_USERS.length }
  } finally {
    await pool.end()
  }
}

// Run directly if invoked via CLI
if (process.argv[1] && process.argv[1].endsWith('seed-deterministic-matrix.mjs')) {
  const dbUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL or TEST_DATABASE_URL must be provided.')
    process.exit(1)
  }
  seedMatrix(dbUrl).catch((err) => {
    console.error('Failed to seed deterministic matrix:', err)
    process.exit(1)
  })
}

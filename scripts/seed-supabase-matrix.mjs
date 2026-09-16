// scripts/seed-supabase-matrix.mjs
// Seeds Supabase Auth (GoTrue) users via the Supabase Admin API and links matching public.profiles.
// Used in CI Supabase matrix legs and local Supabase development.

import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { DETERMINISTIC_USERS, MATRIX_PASSWORD } from './seed-deterministic-matrix.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

if (!serviceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY must be provided to seed Supabase auth users.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function seedSupabase() {
  console.log(`\n=== Seeding Supabase Auth & Profiles at ${supabaseUrl} ===\n`)

  const pool = new pg.Pool({ connectionString: dbUrl })
  try {
    // The Auth trigger rejects new users before GoTrue returns unless the
    // domain is present first. Seed this prerequisite before createUser.
    await pool.query(
      `insert into public.whitelisted_domains (domain, auto_activate)
       values ('vsis.lk', true)
       on conflict (domain) do update set auto_activate = true`
    )

    // 1. Fetch existing Auth users
    const { data: existingUsersData, error: listErr } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    if (listErr) {
      throw new Error(`Failed to list auth users: ${listErr.message}`)
    }

    const userMap = new Map()
    for (const u of existingUsersData.users || []) {
      if (u.email) userMap.set(u.email.toLowerCase(), u.id)
    }

    // Combine deterministic users with any configured E2E accounts
    const usersToSeed = [...DETERMINISTIC_USERS]
    const e2eEmail = (process.env.E2E_EMAIL || 'admin@vsis.lk').toLowerCase()
    const e2ePassword = process.env.E2E_PASSWORD || MATRIX_PASSWORD

    if (!usersToSeed.some((u) => u.email.toLowerCase() === e2eEmail)) {
      usersToSeed.push({
        email: e2eEmail,
        name: 'E2E Administrator',
        permission_role: 'admin',
        hierarchy_role: 'manager',
        isActive: true,
      })
    }

    // 2. Create or update auth accounts
    for (const u of usersToSeed) {
      const email = u.email.toLowerCase()
      const password = email === e2eEmail ? e2ePassword : MATRIX_PASSWORD
      const existingId = userMap.get(email)

      if (existingId) {
        const { error } = await supabase.auth.admin.updateUserById(existingId, {
          password,
          email_confirm: true,
        })
        if (error) {
          throw new Error(`Failed to update auth user ${email}: ${error.message}`)
        }
        console.log(`Updated auth credentials for ${email}`)
      } else {
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name: u.name },
        })
        if (error) {
          throw new Error(`Failed to create auth user ${email}: ${error.message}`)
        }
        userMap.set(email, data.user.id)
        console.log(`Created auth user ${email} (${data.user.id})`)
      }
    }

    // 3. Link profiles in PostgreSQL

    // Reference projects
    await pool.query(
      `insert into public.projects (name, so_number, telegram_no)
       values ('Internal', 'SO-001', 1000)
       on conflict (name) do update set so_number = excluded.so_number`
    )

    // Activity types
    const activityTypes = ['R&D', 'Meeting', 'Certification', 'Presales support', 'Documentation']
    for (const name of activityTypes) {
      await pool.query(
        `insert into public.activity_types (name, is_active)
         values ($1, true)
         on conflict (name) do update set is_active = true`,
        [name]
      )
    }

    // App settings (backfill window)
    await pool.query(
      `insert into public.app_settings (id, backfill_mode, backfill_window_days, backfill_extra_days)
       values (1, 'days', 30, 0)
       on conflict (id) do update set backfill_mode = 'days', backfill_window_days = 30`
    )

    // Upsert profiles
    for (const u of usersToSeed) {
      const email = u.email.toLowerCase()
      const authId = userMap.get(email)
      if (!authId) continue

      await pool.query(
        `insert into public.profiles (id, email, name, role, permission_role, hierarchy_role, is_active)
         values ($1, $2, $3, $4, $4, $5, $6)
         on conflict (id) do update set
           email = excluded.email,
           name = excluded.name,
           permission_role = excluded.permission_role,
           hierarchy_role = excluded.hierarchy_role,
           role = excluded.permission_role,
           is_active = excluded.is_active`,
        [authId, email, u.name, u.permission_role, u.hierarchy_role, u.isActive]
      )
    }

    // Link managers
    for (const u of usersToSeed) {
      if (!u.managerEmail) continue
      const childId = userMap.get(u.email.toLowerCase())
      const managerId = userMap.get(u.managerEmail.toLowerCase())
      if (childId && managerId) {
        await pool.query(`update public.profiles set manager_id = $1 where id = $2`, [managerId, childId])
      }
    }

    console.log(`Successfully synced ${usersToSeed.length} profiles to Supabase database.`)
  } finally {
    await pool.end()
  }
}

seedSupabase().catch((err) => {
  console.error('Supabase seeding error:', err)
  process.exit(1)
})

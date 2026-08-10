# Supabase

This directory version-controls the database schema and Row Level Security (RLS) policies for the VSIS Time Sheet app, so the database can be recreated or reviewed alongside the application code.

## Layout

- `migrations/` — timestamped SQL migrations, applied in order.

## What the schema covers

- `profiles` — one row per `auth.users` signup, created automatically by the `handle_new_user` trigger. New accounts start with `is_active = false`; an admin must activate them before they can log time.
- `projects` — the project list used by the time log form and the admin project management panel.
- `timesheets` — hours logged per user, project, and date.

RLS is the security boundary:

- Users can only read and insert their own timesheets; admins can read everything.
- Users can only read their own profile; admins can read and update all profiles (whitelist and admin-role toggles).
- Projects are readable by any signed-in user but only insertable by admins.
- Pending (inactive) users cannot insert timesheets.

## Applying the migrations

The Supabase CLI is not installed in this repo; use `npx supabase` (or install it globally).

Fresh project / local development:

```bash
npx supabase init
npx supabase start        # local Postgres + Auth
npx supabase db reset     # applies all migrations
```

Existing hosted project:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

## If your database already has these tables

If the tables, trigger, and policies were created manually (e.g. in the Supabase dashboard), `supabase db push` will fail because the objects already exist. In that case, generate a baseline from the live database instead and commit that:

```bash
npx supabase db pull
```

Then treat this initial migration as the reference schema. Note that the first admin has to be granted manually (for example `update profiles set is_admin = true where email = '...';`), since the app has no bootstrap flow.

# Supabase

This directory version-controls the database schema and Row Level Security (RLS) policies for the VSIS Time Sheet app, so the database can be recreated or reviewed alongside the application code.

> This schema is used by the **`supabase` backend mode** (`NEXT_PUBLIC_BACKEND=supabase`). The self-contained **`native` mode** uses `db/migrations/` instead (plain Postgres, no `auth` schema/RLS). See the root [README.md](../README.md) for the two deployment modes.

## Layout

- `migrations/` — timestamped SQL migrations, applied in order.

## What the schema covers

- `profiles` — one row per `auth.users` signup, created automatically by the `handle_new_user` trigger. New accounts start with `is_active = false`; an admin must activate them before they can log time.
- `projects` — the project list used by the time log form and the admin project management panel.
- `timesheets` — hours logged per user, project, and date.

RLS is the security boundary (roles come from `profiles.role` via the `has_role()` SECURITY DEFINER helper):

- `timesheets` — users insert/select/update/delete their own rows; admins and COs can read everything; admins can also update/delete/insert any row (the admin insert policy backs the "Backfill Yesterday" feature).
- `profiles` — users read only their own row; admins and COs read all; only admins update.
- `projects` — readable by any signed-in user; admins and PMs insert/update/delete.
- `leaves` / `reminders` — users manage their own rows; admins additionally manage all leave rows.
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

Then treat this initial migration as the reference schema. Note that the first admin has to be granted manually (for example `update profiles set role = 'admin' where email = '...';`), since the app has no bootstrap flow.

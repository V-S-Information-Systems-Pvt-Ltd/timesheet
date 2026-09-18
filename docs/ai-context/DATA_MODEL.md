# Data Model

The database has two migration histories with equivalent application concepts. Treat migration SQL and the `Repository` contract as authoritative for current schema/behavior.

## Core entities

| Entity | Key relationships / purpose |
| --- | --- |
| `profiles` | Application identity/profile, active state, role axes, hierarchy; native mode also owns password/session-version state |
| `projects` | Timesheet project reference data |
| `activity_types` | Optional timesheet activity classification |
| `timesheets` | Belongs to profile + project; optionally activity type; daily work record |
| `leaves` | Belongs to profile; unique user/date behavior is established in schema |
| `reminders` | User-scoped reminders |
| `global_reminders` | Workspace/global reminders with per-user dismissal records |
| `app_settings` | Shared/default workspace settings and layouts |
| `audit_logs` | Actor-linked audit records |
| `whitelisted_domains` | Signup/domain admission configuration |
| `titles` | Title/reference data used by hierarchy/role-alignment workflows |
| `mobile_sessions` | User-bound refresh/session family, rotation/revocation/expiry state |
| `password_reset_tokens` | Native password-recovery token state; introduced in native migrations |
| `rate_limits` | Persistent rate-limit reservations/state |
| `idempotency_keys` / effects | Mutation idempotency state and recorded effects |

## Schema rules for agents

- Do not infer schema solely from generated database types; verify migrations and repository consumers.
- Cross-backend data behavior requires parity in native and Supabase adapters and usually paired migrations.
- Never edit an already-applied migration; add a new migration.
- Future-dated migration filenames may exist in the repository. Presence in Git does not prove a specific deployed database has applied them.

## Ownership and isolation

- User-owned records such as timesheets, leaves, reminders, and mobile sessions are keyed to `profiles` and constrained by actor/resource rules.
- Native mode enforces isolation through repository/application authorization plus scoped parameterized SQL.
- Supabase mode enforces equivalent application behavior with actor checks plus RLS and narrowly granted RPCs.
- Reporting/hierarchy access can intentionally cross direct ownership boundaries, but only through the established permission/hierarchy scope rules.

## Transaction boundaries

- Native repository operations that need atomic multi-row behavior use PostgreSQL transactions through the native DB layer; preserve established lock ordering in session/password flows.
- Supabase multi-step operations use database functions/RPCs where atomicity is required by the existing contract (for example bulk/idempotency/session-related behaviors).
- The exact transaction boundary for a proposed change must be verified in the relevant adapter/function rather than inferred from this summary.

Evidence: `db/migrations/0001_initial_schema.sql`, `db/migrations/0002_features.sql`, later `db/migrations/`, `supabase/migrations/`, `lib/db/repository.ts`.

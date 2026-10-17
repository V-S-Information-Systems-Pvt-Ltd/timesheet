# Contributing to VSIS Timesheet

Thank you for your interest in contributing. This guide covers the development
setup, branch strategy, test/migration workflow, and PR expectations.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Development setup](#development-setup)
- [Branch strategy](#branch-strategy)
- [Commit conventions](#commit-conventions)
- [Running tests](#running-tests)
- [Adding database migrations](#adding-database-migrations)
- [Persistence and auth layout](#persistence-and-auth-layout)
- [Pull request checklist](#pull-request-checklist)
- [Architecture overview](#architecture-overview)

## Code of conduct

Be respectful, constructive, and assume good intent. Reviewers should focus on
correctness, security, and maintainability; submitters should respond to feedback
with patches rather than debate.

## Development setup

Prerequisites: Node.js 20.9+ (developed against Node 25) and npm.

```bash
npm install
cp .env.example .env.local
# fill in DATABASE_URL and AUTH_SECRET, then run `npm run db:migrate && npm run db:seed`
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Backend

The app runs on self-hosted PostgreSQL (`DATABASE_URL`) with in-app email/password
auth (scrypt + signed cookie). There is no other backend. Use `npm run db:migrate`
and `npm run db:seed` to bootstrap.

See [README.md](README.md) for the full environment variable reference and
deployment options.

## Branch strategy

- `main` is the production-ready branch. It is protected: PRs require review
  and passing CI.
- `dev` is the long-lived integration branch, deployed to https://ts-dev.kst.st
  (Neon preview database). Feature and fix PRs target `dev`; `main` only takes
  release PRs from `dev`.
- Feature work lives on short-lived feature branches off `dev`:
  `feat/<short-description>`.
- Bug fixes live on `bugfix/<short-description>`.
- Phase work (multi-week initiatives) lives on `phase-<number>-<description>`.
- Do not commit directly to `main` or `dev`.

### Naming conventions

- Use lowercase and hyphens: `feat/bulk-operations`, `bugfix/login-redirect`.
- Keep it under 40 characters if possible.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

| Type | When to use |
| --- | --- |
| `feat` | A new feature or user-facing improvement |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build, CI, dependencies, tooling |
| `perf` | Performance improvement |
| `security` | Security hardening |

Scope is optional but encouraged: `feat(ui): add bulk-actions toolbar`,
`fix(actions): handle empty work_done`, `test(dates): cover new presets`.

### Body

If the commit needs more context, leave a blank line after the description and
write a short body explaining the **why**, not the **what** (the diff shows the
what). Reference issues by ID if applicable.

## Running tests

```bash
npm test                # run all unit tests once (vitest)
npm run test:watch      # not configured yet; use `npx vitest` for watch mode
npm run lint            # eslint
npm run build           # production build + TypeScript check
```

### Writing tests

- Place tests in `tests/<module>.test.ts`.
- Use `vitest` and follow the existing patterns in `tests/`.
- Mock `localStorage` with `vi.stubGlobal('localStorage', mock)`.
- Mock DOM elements with plain object shapes when needed (see
  `tests/shortcuts.test.ts`).
- Prefer testing pure functions (`lib/dates.ts`, `lib/validation.ts`,
  `lib/shortcuts.ts`). For components, test behavior rather than markup
  structure when possible.

### Coverage targets

- `lib/` and `app/actions.ts`: target >60% line coverage.
- New features should include tests for both the happy path and at least one
  failure mode.

## Adding database migrations

1. Create a new SQL file: `db/migrations/NNNN_short_description.sql`.
2. Use the next available sequence number (check the highest existing file).
3. Write the migration as a single transaction. The runner applies each file
   inside `BEGIN; ... COMMIT;`.
4. Keep migrations idempotent where possible (use `IF NOT EXISTS`, etc.).
5. Run `npm run db:migrate` to apply locally.
6. Do **not** edit an existing migration after it has been merged to `main`.

## Persistence and auth layout

- `lib/db/` — native PostgreSQL pool, domain composition modules and the
  adapters in `lib/db/native/`.
- `lib/auth/` — client + server auth.

When changing data access or auth behavior, enforce authorization in the SQL
predicates of the native adapter and keep server actions and API routes on the
shared domain ports.

## Pull request checklist

Before opening a PR:

- [ ] `npm run lint` passes with no errors.
- [ ] `npm test` passes.
- [ ] `npm run build` succeeds.
- [ ] New/modified behavior is covered by tests.
- [ ] `lib/` changes include or update unit tests.
- [ ] Database migrations are included and documented.
- [ ] `README.md` or `docs/guides/USER_GUIDE.md` is updated if the change is
      user-visible.

PRs should stay focused. If a PR includes refactoring, feature work, and
migrations, split it.

## Architecture overview

The VSIS Timesheet is a Next.js 16 App Router app with:

- **Server actions** (`app/actions.ts`) for mutations.
- **REST API routes** (`app/api/`) for data fetching.
- **Shared UI components** (`app/components/ui.tsx`) using Tailwind CSS 4.
- **PostgreSQL persistence** (`lib/db/`) behind narrow domain ports.

The data flow for a timesheet entry:

1. Client calls a server action (`logEntry`).
2. Server action validates input (`lib/validation.ts`) and enforces role/backfill
   rules.
3. The domain service writes through its persistence port (`lib/db/native/`).
4. The client refetches or optimistically updates local state.

For the full picture, see the [Project structure](README.md#project-structure)
section in the README.

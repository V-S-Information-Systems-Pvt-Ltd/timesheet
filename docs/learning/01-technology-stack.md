# Technology stack and development environment

Snapshot: 2026-10-08. Manifest ranges express allowed versions; lockfiles record resolved versions; installed versions were independently checked for the packages below. This checkout already had release-related manifest and lockfile changes before the learning task.

## Languages

| Language / notation | Version or configuration evidence | Where and why |
| --- | --- | --- |
| TypeScript | Root and mobile lockfiles/installations: **5.9.3**; root manifest `^5`, mobile `^5.8.3` | `.ts` modules and `.tsx` UI; describes input, output, and object shapes before execution |
| JavaScript | Root TS compilation target **ES2020**, with `esnext` library definitions; Node 22 is used by Docker/CI | `.mjs` operator/build scripts and `.js` mobile/tool configuration; also the runtime output of TypeScript |
| JSX / TSX | Root `jsx: react-jsx`; React versions below | UI expressions inside JavaScript/TypeScript; JSX is syntax, not a separate runtime language |
| SQL / PL/pgSQL | PostgreSQL **16** in Compose and CI; actual deployed database version unknown | Tables, indexes, triggers, authorization policies, and transactional functions in both migration histories |
| CSS | Tailwind CSS **4.3.3** resolved/installed | Global styles, theme variables, and utility classes in web components |
| Kotlin, Swift, C++ | Compiler/toolchain versions not established by this analysis | Mobile native startup and secure-storage bridges; secondary study after TypeScript/React |
| YAML, JSON, XML, Gradle build notation | Configuration formats; no single language-runtime version applies | CI, deployment, manifests, TypeScript configuration, Android and Windows packaging |

Evidence: [root TS configuration](../../tsconfig.json), [mobile TS configuration](../../mobile/tsconfig.json), [Compose](../../docker-compose.yml), [Android storage bridge](../../mobile/android/app/src/main/java/com/vsis/timesheet/VsisSecureStorageModule.kt), [iOS storage bridge](../../mobile/ios/mobile/VsisSecureStorage.swift), and [Windows storage declaration](../../mobile/windows/VsisTimesheetMobile/VsisSecureStorage.h).

`@types/node` describes available APIs for the type checker; its major version does not select the executing Node version. Similarly, `target: ES2020` controls compilation compatibility, not the complete set of APIs guaranteed in every runtime.

## Frameworks and important libraries

Root evidence: [package manifest](../../package.json), `package-lock.json`, and corresponding installed `node_modules/<package>/package.json` entries.

| Dependency | Declared → resolved and installed | Problem solved / source anchor |
| --- | --- | --- |
| Next.js | `^16.3.8` → **16.3.8** | File-based routes, server rendering, HTTP handlers, build and self-hosting; [dashboard page](../../app/dashboard/page.tsx) |
| React / React DOM | `19.2.4` → **19.2.4** | Components and browser UI rendering; [time-entry form](../../app/dashboard/time-entry-form.tsx) |
| Zod | `^4.4.3` → **4.4.3** | Runtime parsing/refinement of external input; [timesheet contracts](../../packages/contracts/src/timesheets.ts) |
| `pg` | `^8.23.0` → **8.23.0** | PostgreSQL pool, parameterized SQL and transactions; [pool](../../lib/db/pool.ts) |
| `@supabase/supabase-js` | `^2.110.8` → **2.110.8** | Provider authentication and data/RPC access; [Supabase timesheet adapter](../../lib/db/supabase/timesheets.ts) |
| `@supabase/ssr` | `^0.12.3` → **0.12.3** | Supabase clients integrated with browser/server cookies; [server client](../../lib/supabase/server.ts) |
| `jose` | `^6.2.8` → **6.2.12** | JWT signing/verification; [native session tokens](../../lib/auth/jwt.ts) |
| Nodemailer | `10.0.13` → **10.0.13** | Native password-recovery SMTP delivery; [email module](../../lib/email/password-reset.ts) |
| Recharts | `^3.10.1` → **3.10.1** | Chart UI; [charts](../../app/components/charts.tsx) |
| Tailwind CSS | `^4` → **4.3.3** | Utility styling plus custom theme variables; [global CSS](../../app/globals.css) |
| `server-only` | Manifest `^0.0.1` | Marks imports that belong on the server; [timesheet composition](../../lib/db/timesheets.ts) |

There is no Prisma/Drizzle-style ORM in these application persistence paths. Native code explicitly writes SQL; Supabase code builds provider queries and calls RPCs. A fluent query builder does not make the native adapter an ORM.

## Mobile and shared packages

Evidence: [mobile manifest](../../mobile/package.json), `mobile/package-lock.json`, [mobile app](../../mobile/App.tsx), and [Metro configuration](../../mobile/metro.config.js).

| Package | Resolved and installed | Responsibility |
| --- | --- | --- |
| Mobile React | **19.2.3** | React component model for native UI; differs from web React's patch version |
| React Native | **0.84.1** | Android/iOS native components and runtime integration |
| React Native Windows | **0.84.0** | Windows host/platform implementation |
| Mobile TypeScript | **5.9.3** | Mobile-specific type-checking workflow |
| Mobile Jest | **29.7.0** | Mobile tests; web/server tests use Vitest |
| `@vsis/core` | Local package **0.1.0** | Platform-neutral calculations, dates and hierarchy helpers |
| `@vsis/contracts` | Local package **0.1.0** | Canonical validation schemas, types and DTOs; depends on core |
| `@vsis/client` | Local package **0.1.0** | Typed HTTP-client logic; depends on contracts |
| `@vsis/migration-tool` | Local private package **1.0.3** | Operator migration workflows; application runtime must not import it |

Root npm workspaces include `packages/*` and `migrations/tool`. Mobile has a separate manifest/lockfile and local file dependencies on the three shared application packages. Both Next and Metro must resolve/compile shared TypeScript sources; the web `transpilePackages` setting is explicit in [Next configuration](../../next.config.ts).

## Rendering and architecture

The web uses the **Next.js App Router**, not the older Pages Router. `page.tsx` supplies route UI, `layout.tsx` supplies shared wrapping UI, and `route.ts` supplies HTTP methods. Server Components are the default; `'use client'` creates a client-module boundary for interactive code. Client Components can also contribute initial server-rendered HTML; the directive does not mean “never executes during server rendering.”

Actual examples: [server dashboard page](../../app/dashboard/page.tsx), [interactive welcome page](../../app/page.tsx), [HTTP timesheet route](../../app/api/v1/timesheets/route.ts). The dashboard awaits asynchronous `searchParams`, loads a server seed, and passes it to a client component. Read [flows](05-code-execution-flows.md) before drawing conclusions about streaming or loading order.

Version-specific framework behavior was checked against the installed guides under `node_modules/next/dist/docs/01-app/01-getting-started/`, especially `05-server-and-client-components.md` and `15-route-handlers.md`. Future sessions should recheck the installed guides after upgrades.

## Tools and authoritative commands

The npm lockfiles use format version 3. The exact npm version used to create them was not established. Node 22 is configured in Docker/CI; mobile declares Node `>=22.11.0`.

| Task | Root command | Meaning / prerequisite |
| --- | --- | --- |
| Install | `npm ci` | Reproduce the lockfile; changes dependency installation, so use in a development checkout |
| Develop | `npm run dev` | Next development server |
| Lint | `npm run lint` | ESLint **9.39.5**; [configuration](../../eslint.config.mjs) |
| Type-check | `npm run typecheck` | `tsc --noEmit`; checks types without emitting JavaScript |
| Unit tests | `npm test` | Vitest **4.1.11**; [configuration](../../vitest.config.mts) |
| Coverage | `npm run test:coverage` | Aggregate 60% lines/functions/statements, 50% branches; stricter selected-file gates |
| Build | `npm run build` | Prebuild provider-auth configuration checks, Next compilation/type checks, then standalone asset copying |
| Browser tests | `npm run e2e` | Playwright **1.62.1**; production build plus seeded credentials, or explicit external test URL |
| Accessibility | `npm run a11y` | Playwright/axe workflow for affected UI |
| DB integration | `npm run db:concurrency-test`, `npm run db:password-recovery-test` | A migrated test PostgreSQL database via `TEST_DATABASE_URL`; inspect configuration before execution |
| Performance | `npm run benchmark`, `npm run benchmark:http`, `npm run load` | Endpoint scripts and external k6 CLI; suitable test server/data required |
| Native migrations / seed | `npm run db:migrate`, `npm run db:seed` | Database-writing operator commands, not read-only learning exercises |

Mobile commands run from `mobile/`: `npm run lint` (ESLint **8.57.1**), `npm run typecheck`, `npm test` (Jest), `npm start` (Metro), and platform/package scripts in its manifest. Root checks exclude mobile where configured; passing root checks does not prove mobile correctness.

[CI](../../.github/workflows/ci.yml) defines lint, coverage, types, both backend builds, database/browser checks, Docker, operator-package checks, and separate mobile checks. This task inspected these workflows; it did not execute them.

For debugging, combine editor definitions/references, browser Network requests, React state inspection, breakpoints, and focused existing tests. The source-backed exercises specify what to observe before changing anything.

## Build and deployment

[Next configuration](../../next.config.ts) produces standalone output outside Vercel. [Dockerfile](../../Dockerfile) uses Node 22 build/runtime stages, bakes in native mode, copies standalone/static/public/DB assets, and runs `node server.js` as UID 1001. [Compose](../../docker-compose.yml) adds PostgreSQL 16. [Deployment](../../deploy/deployment.yaml) wires ConfigMap/Secret configuration and probes; OpenShift-specific overlays live under `deploy/openshift/`.

`NEXT_PUBLIC_*` values can enter browser bundles during build. A backend switch requires the corresponding rebuild rather than only a runtime pod environment change. Database credentials and signing keys belong in server-side configuration. Supabase mode additionally depends on provider Auth/PostgREST/RLS configuration. The repository's deployment files establish supported arrangements, not which environment is currently running.

The Telegram feature examined here formats and copies a command; [formatter](../../lib/telegram.ts) and [form](../../app/dashboard/time-entry-form.tsx) do not demonstrate an outbound Telegram Bot API call. SMTP password recovery is an actual external-delivery integration when configured.

# Architecture Decision Request: maintenance ingress

## Decision Required

How should both backends stop new application requests during operator maintenance while keeping a database-independent maintenance page and health probes reachable?

## Why This Decision Is Needed

Provide a server-only runtime switch, temporary page redirects, and non-replayed write rejection. No auth, database, migration, or administrator bypass changes. This packet records the scoped decision before implementation; no additional agents are requested.

## Current Architecture

Root `app/layout.tsx` reads branding for metadata, viewport, and layout through `lib/branding-server.ts`. Native/Supabase reads share the workspace boundary. Application HTTP includes ordinary APIs, versioned APIs, and Server Action POSTs to page paths.

## Relevant Existing Decisions

- `AGENTS.md`: preserve backend parity, public contracts, and existing authorization.
- `ASTRA_ARCHITECT.md`: bound decisions to supplied source evidence.
- `docs/ai-context/ARCHITECTURE_DELTA.md`: existing migration fences are separate from deployment-wide admission.

## Constraints

- Enable only for exact `MAINTENANCE_MODE === 'true'`, evaluated inside request functions; no public/build-time switch.
- Next 16 root `proxy.ts`, Node runtime by default, no runtime export.
- Match all paths. Exempt only GET/HEAD of exact maintenance/health paths, bounded framework assets, and enumerated existing public/metadata assets. No extension, identity, role, or IP bypass.
- Requests reaching Proxy: GET/HEAD pages get a temporary redirect to `/maintenance`, discard query, no-store. APIs and all other methods receive 503 JSON, Retry-After, no-store.
- `/api/v1` errors retain `{ data: null, error: { code, message } }`; other errors use `{ error: string }`.

## Evidence

### Repository map evidence

- FACT — Root's Atlas attempt was denied; root used Serena and targeted source instead. Scope was supplied directly; no graph inference is needed.

### Relevant symbols

- FACT — `app/layout.tsx`: `generateMetadata`, `generateViewport`, `RootLayout` each call `getCachedBranding` before this change.
- FACT — `lib/branding-server.ts`: `getCachedBranding` invokes `getBrandingOrDefault(workspaceDeps())`.
- FACT — `app/api/v1/_http.ts`: `apiError` emits the versioned error envelope and imports authentication dependencies; Proxy should reproduce the small envelope without importing those dependencies.

### Relevant implementation observations

- FACT — Starting tree clean, HEAD `a82b3180295afdf0eb18f018de2c28303acb2f6d`; no Proxy or Middleware exists.
- FACT — Installed `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` specifies execution before filesystem routes, Node runtime, constant matcher, and `unstable_doesProxyMatch` testing.
- FACT — Installed Next 16.3.8 exports `unstable_doesMiddlewareMatch` instead; the test uses that existing experimental matcher helper.
- FACT — Installed `01-app/02-guides/environment-variables.md` and `03-api-reference/04-functions/connection.md` describe request-time environment reads after `connection()`.
- FACT — `app/api/health/live/route.ts` is dependency-free; `app/api/health/route.ts` still checks backend readiness. Maintenance must preserve those semantics.
- FACT — Existing assets are enumerated under `public/`, plus `app/favicon.ico` and `app/icon.png`.
- INFERENCE — Short-circuiting branding after `connection()` keeps all three layout entry points independent of backend calls during maintenance and avoids prerendering the runtime decision.

## Architecture Delta

Against `a82b318`, add one global ingress policy and request-time default branding. Repository, auth, schema, backend selection, and migration-fence contracts stay unchanged.

## Known Risks

- Proxy is a UX/application-ingress control, not a transactional writer fence. Already-running requests, external Supabase calls/auth, jobs, direct database access, and browser content already loaded are not stopped by the switch.
- Environment changes require process restart/container recreation or platform redeployment. A rolling change can leave mixed worker states until all instances converge.
- Readiness may still return 503 during backend maintenance; liveness remains independent.
- Next canonical URL normalization can issue a body-preserving redirect before Proxy (for example trailing/repeated slashes); the normalized destination is still rejected. No global URL-normalization configuration changes are required.
- Server Action clients receive a rejected promise for the Proxy JSON 503, not their usual action `{ error }` or a maintenance-specific message. Root verified existing update/delete catch paths roll back local optimistic state; production/RSC behavior remains a root smoke check.

## Alternatives

### Option A — Selected: Proxy plus runtime layout branding guard

Keep the gate dependency-free; match everything and inspect method before exemptions. Use a server-only helper for the strict flag. Default branding avoids DB reads; maintenance renders 200 with a plain home retry link. Lifecycle: enable by restart/redeploy, reject new ingress reaching Proxy, preserve probe/asset reads, disable by restart/redeploy; test both directions without module reload. Proxy never redirects non-read requests; earlier Next canonical redirects may preserve their bodies before the destination is rejected. No durable artifacts or migrations.

### Option B — Build-time/public flag

Rejected: freezes admission into the build or exposes server policy to clients; cannot safely reuse an image with a runtime switch.

### Option C — Database setting or auth/admin bypass

Rejected: requires a dependency that maintenance may take offline and adds unauthorized bypass semantics. Does not solve external writer fencing.

## Unresolved Questions

- UNKNOWN — Production adapter/standalone behavior and both backend builds require root integration verification. Focused tests can validate matcher, response contracts, and no-branding-call behavior but cannot replace production smoke.

## Scout Synthesis

FACTs above were supplied by root or checked directly in source. No graph-derived assumptions or further delegation.

## Requested Astra Output

No escalation in this implementation assignment. Root owns independent HTTP compatibility review and final build/smoke verification. Acceptance checks: enabled/disabled and runtime toggles, exact exemption boundaries, dotted APIs, versioned envelope, write rejection including maintenance/health POSTs, query removal, matcher coverage, and all layout entry points skipping DB branding.

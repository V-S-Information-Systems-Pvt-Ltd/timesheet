# Mobile Administration, Customization, and Web Parity

## Context

The React Native client already supports the core employee workflows, reports,
and a flat role-gated Team directory, while the web dashboard contains the
routine administrative workflows and per-user/default layout controls. This
plan closes the requested mobile gaps without moving backup/restore, imports,
factory reset, permanent user deletion, or email-domain administration onto
mobile. It also fixes the reported duplication, project picker, desktop login,
and Android icon defects and adds the same read-only hierarchy experience to
web and mobile.

The implementation is split into independently shippable vertical slices in
`docs/plans/slices/`. During implementation, record code-forced deviations in
`docs/plans/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md`.

## Approach

1. **Make mobile navigation modular before adding admin screens.** Replace the
   hard-coded Home/More lists with one typed module registry. The registry owns
   route metadata, capability requirements, default placement, and whether a
   module is essential. Store a nullable per-user `mobile_layout` and one
   `default_mobile_layout` in the existing profile/app-settings boundaries.
   Server-authored capabilities filter the effective layout; layout visibility
   never authorizes an API call. `Log Time`, `Timesheets`, and
   `Profile/Security` remain reachable even if saved JSON is incomplete.
2. **Add workspace-scoped presentation settings.** Extend the single
   `app_settings` row with app name, primary color, and HTTPS logo URL. Expose
   the safe presentation subset through `/api/v1/config` so disconnected and
   signed-out mobile surfaces can render it after a workspace is connected.
   Add super-admin web and mobile editors. Invalid, unavailable, or missing
   values fall back to the bundled VSIS name, crimson palette, and logo.
3. **Keep connection defaults and user theme local.** Add a documented mobile
   build-time parameter for the default workspace URL. It pre-populates the
   connection flow only when no user-selected workspace exists; changing or
   disconnecting the workspace remains supported. Persist `System`, `Light`,
   or `Dark` locally per device and apply it before authentication.
4. **Expand hierarchy safely.** Add `engineer` to `hierarchy_role` in forward
   native and Supabase migrations. It is non-leadership and receives the same
   visibility as `user`. Add a hierarchy classification to each configurable
   title and derive a user's hierarchy role from the chosen title. Keep
   `permission_role` independent. Map `engineer` to `user` only in the legacy
   compatibility column and continue using `hierarchy_role` for new logic.
5. **Complete Team as a shared read-only product feature.** Build one semantic
   tree model from the authorized profiles returned by the repository. Render
   it as an expandable reporting tree plus searchable directory on web and
   mobile. Selecting a visible member opens Timesheets or Reports with an
   authorized user filter. Keep hierarchy mutation in the admin module.
6. **Add routine admin parity through versioned APIs.** Create narrow
   `/api/v1/admin/**` route/service groups for reference data, people and
   hierarchy, operational settings, leave/backfill, global reminders, and
   privileged reports. Reuse repository operations and shared validation;
   preserve Server Action names and web behavior. Every route gates the actor
   server-side and both adapters must return equivalent results.
7. **Fix reported time and platform defects at their existing boundaries.**
   Collect and confirm a target date before single or bulk duplication; choose
   the project named `Internal` rather than the first sorted project; reproduce
   the Windows picker failure with a large reference list before changing its
   rendering path; wire desktop submit-key behavior to the existing guarded
   sign-in handler; and replace/normalize the font-dependent Timesheets glyph
   through the shared icon adapter.
8. **Roll out slice by slice.** Apply additive migrations first, deploy APIs
   that tolerate null/old settings, then ship clients that consume them. Old
   clients continue receiving compatible config and actor fields. Each slice
   carries focused tests and must remain green in native and Supabase modes.

## Key decisions

- Routine mobile administration includes projects, activity types, user
  provisioning and activation, permission/title/hierarchy assignment,
  reporting lines, backfill settings and entry, leave administration, global
  reminders, and privileged reports/export.
- Backup/restore, imports, factory reset, permanent user deletion, and email
  domain whitelist management remain web-only.
- Runtime branding changes in-app surfaces and web document/UI branding. Native
  package identifiers, launcher names, launcher icons, and store metadata remain
  build artifacts and are not changed remotely.
- The logo setting is an HTTPS URL, not an uploaded file. Enforce URL and length
  validation and show bundled branding on load failure.
- The primary color is one validated hex color. Derive hover/pressed/tint
  variants in the existing semantic theme layer and reject colors that cannot
  provide accessible action contrast in both light and dark themes.
- Theme preference is device-local and three-state; it is not stored in the
  user profile or synchronized across devices.
- The build-time default workspace never overwrites a persisted user choice.
  It is a deployment default, not a remotely discoverable workspace.
- Internal hierarchy roles remain `manager`, `team_lead`, `engineer`, and
  `user`. Only the first two are leaders. Custom titles map to these roles;
  super-admins cannot create new authorization semantics.
- Self-service title edits may select only a title classified to the actor's
  current hierarchy role. Any title change that would change hierarchy
  classification is admin-only, so profile editing cannot promote Team access.
- Team visibility continues to be server-authored: admin/CO see the authorized
  all-user scope, managers/team leads see their repository-scoped teams, and
  PM/engineer/user do not gain visibility solely from the UI.
- Essential mobile destinations cannot be hidden. Optional modules may be
  reordered/hidden but capability filtering always wins over saved layout.
- No offline admin mutations. Cached reads may be displayed as stale, with
  mutation controls disabled until connectivity returns.
- Use existing React Native/platform APIs before adding a dependency. Report
  file export is the only expected compatibility spike; any dependency must
  prove Android, iOS, and React Native Windows 0.84 support first.

## Data and contract changes

- Add nullable `profiles.mobile_layout jsonb` and
  `app_settings.default_mobile_layout jsonb` in new forward migrations for both
  backends. Validate JSON against the registry and merge missing essential/new
  module IDs on read.
- Add `app_settings.app_name`, `app_settings.primary_color`, and
  `app_settings.logo_url` with safe defaults/nullability. Return only these
  presentation fields from public workspace config.
- Add `titles.hierarchy_role` constrained to the four hierarchy roles. Backfill
  exact Manager/Team Lead matches to their leader roles, engineering titles to
  `engineer` only where the migration has an explicit deterministic mapping,
  and all other titles to `user`; do not guess from arbitrary substrings.
- Widen `profiles.hierarchy_role` constraints and update the legacy-role sync
  trigger so `engineer` resolves to legacy `user`.
- Extend actor capabilities with the smallest explicit admin/module flags
  required by the route registry. Compute them in `lib/roles.ts` and serialize
  them through the existing actor DTO; do not derive them independently in
  mobile code.
- Add versioned preference/admin DTOs and route schemas. Return the existing
  `{ data, error }` API envelope, field errors for validation failures, 403 for
  capability failures, 409 for conflicts, and bounded/paginated collections.
- Preserve existing Server Action signatures. Extract only shared validation or
  domain helpers that prevent policy drift; do not call Server Actions from API
  routes.

## Files to modify

### Schema, repository, and policy

- New forward migrations after the current native/Supabase migration heads;
  never edit an applied migration. Update the generated Supabase database types.
- `app/types.ts`, `lib/roles.ts`, `lib/hierarchy.ts`, `lib/layout.ts`, and
  `lib/db/repository.ts` for the expanded role, title classification, settings,
  layouts, and admin contracts.
- `lib/db/native.ts` and `lib/db/supabase.ts` for behaviorally identical reads,
  writes, pagination, role scoping, and settings persistence.

### API and web

- `lib/api/v1/contracts.ts`, `lib/api/v1/services/**`, `app/api/v1/config/route.ts`,
  and new focused `app/api/v1/admin/**` and preference routes.
- Existing `app/actions/**` and dashboard panels only where shared validation,
  branding, title classification, default mobile layout, or Team navigation
  needs to be surfaced. Preserve action names and role gates.
- Add a role-gated web Team surface using the shared hierarchy projection; keep
  the existing admin hierarchy editor as the mutation surface.
- `app/globals.css`, `app/components/ui.tsx`, `app/layout.tsx`, and brand assets
  consumers for semantic runtime branding with accessible fallbacks.

### Mobile

- `mobile/App.tsx`, navigation routes/reducer, Home/More/AdaptiveNavigation,
  theme, workspace storage, and SessionProvider for the module registry,
  layout preferences, branding config, build-time workspace default, and local
  theme preference.
- `mobile/src/screens/**` and focused reusable components for Team, admin hubs,
  project/activity management, people/hierarchy, operational administration,
  and privileged reports.
- Existing Timesheet, TimeEntryForm, SignIn, picker, and icon components for the
  reported bug fixes. Avoid duplicating screen-specific forms when an existing
  shared component already owns the state and validation.
- Mobile build documentation and `.env.example` for the default workspace
  parameter; never embed credentials or tokens.

### Tests and documentation

- Add/extend root Vitest coverage for migrations, role/capability policy,
  config, preferences, each admin route group, duplicate behavior, Team scope,
  and adapter parity.
- Add/extend mobile Jest coverage for registry/layout merging, branding/theme,
  workspace precedence, duplicate date UI, Internal selection, large Windows
  picker lists, keyboard submission, icons, Team drill-down, and every admin
  screen's loading/error/offline/authorization states.
- Extend authenticated Playwright coverage for web branding, Team hierarchy,
  member drill-down, and unchanged web admin behavior.
- Update `docs/architecture/unified-experience-contract.md`, mobile README, user
  guide, and the older web/mobile unification plan where its web-only admin and
  fixed-brand assumptions are superseded.

## Risk and rollout controls

- **Authorization drift:** mobile visibility is not a security boundary. Route
  tests cover every permission/hierarchy combination, and repository scoping is
  exercised in both backend modes.
- **Role migration:** expanding a constrained role touches types, SQL checks,
  triggers, RLS/team helpers, DTOs, and tests. Deploy additive SQL and tolerant
  readers before assigning `engineer` to profiles.
- **Title reclassification:** changing a title's classification could silently
  alter many users. The editor must show the affected-user count and require
  confirmation; apply updates transactionally or leave existing users unchanged
  until an explicit reassignment. Record the chosen policy in the slice notes.
- **Self-service privilege escalation:** the existing profile flow lets users
  edit their own title. Enforce same-classification selection in the shared
  service/repository boundary and cover direct API/Server Action attempts.
- **Broken saved layouts:** validate, drop unknown IDs, merge new essential IDs,
  and offer Reset to Default. Never render an empty/unrecoverable shell.
- **Brand contrast or unreachable logo:** reject unsafe colors, cache no secret
  data, and fall back per field without blocking sign-in.
- **Windows picker behavior:** the current API/repository returns the full
  project collection, but the UI failure is not yet reproduced. Capture a
  failing Windows test or manual artifact before changing virtualization/modal
  behavior.
- **Export dependency:** prove file creation/save/share on all three platforms
  before adoption. If no maintained compatible path exists, stop the export
  slice and report options rather than shipping inconsistent platform behavior.
- **Mixed client versions:** keep config and actor additions backward-compatible
  and default absent fields. Do not make new response fields mandatory for old
  clients during rollout.
- **Existing dirty worktree:** the current uncommitted mobile auth/repository
  changes are user work. Implementers must preserve them and keep slice diffs
  separate.

## Out of scope

- Backup/restore, data import, factory/database reset, permanent user deletion,
  and email-domain whitelist management on mobile.
- Runtime changes to native bundle/package IDs, launcher/store name, launcher
  icon, signing assets, or store listings.
- Logo upload or storage service, arbitrary CSS/theme editing, per-component
  color overrides, or a generic feature-flag framework.
- Web dark mode and server-synchronized theme preferences.
- Custom permission roles or custom authorization semantics beyond the four
  fixed hierarchy classifications.
- Offline mutation queues for administration.
- Changes to the existing permission-role meanings or PM Team visibility.

## STOP conditions

- A slice requires weakening RLS/repository scoping or using a Supabase
  service-role read that exposes rows outside the actor's authorized scope.
- The next migration identifier is not unique or the target databases disagree
  about applied migration state. The repository currently contains two native
  `0017_*` files; choose a new unique forward number and do not rename applied
  files without an explicit migration-history decision.
- Runtime branding is expected to change native launcher/store metadata without
  rebuilding the app.
- A title-classification change cannot be made transactional or cannot present
  its impact before altering existing users.
- Windows project-list failure cannot be reproduced and no evidence identifies
  a safe rendering change; report the instrumentation results instead of
  guessing.
- No file export approach proves support for Android, iOS, and React Native
  Windows 0.84 without unsupported native forks.
- Completing a route would require changing an existing Server Action signature
  or making native and Supabase behavior intentionally different.

## Acceptable finish

All twelve slice acceptance criteria pass; both backend builds and targeted
tests are green; Android and Windows manual evidence is captured locally and
iOS evidence is captured in macOS CI/device testing; each requested flow works
through the real API and role gate; old clients tolerate the additive contract;
and the implementation notes end with the commands/evidence used to finish.

## Verification

Run focused tests while implementing each slice, then the following integration
set from the repository root:

```powershell
npx vitest run tests/db-migrations.test.ts tests/supabase-migrations.test.ts tests/hierarchy.test.ts tests/action-policy.test.ts tests/mobile-contract-parity.test.ts tests/mobile-config-route.test.ts
npm run lint
npm run typecheck
npm test
$env:NEXT_PUBLIC_BACKEND='supabase'; npm run build
$env:NEXT_PUBLIC_BACKEND='native'; npm run build
npm --prefix mobile run lint
npm --prefix mobile run typecheck
npm --prefix mobile test
npm --prefix mobile run test:windows
npm --prefix mobile run bundle:windows
```

Expected: no lint/type errors; all root/mobile tests pass; both Next.js backend
builds succeed; the Windows bundle is produced. Then run authenticated web e2e
against seeded roles and execute the slice checklists on Android and Windows.
Run the same mobile suite/build on macOS CI and smoke-test the iOS binary because
the current Windows workspace cannot produce iOS runtime evidence.

## Slices

- `docs/plans/slices/01-mobile-modules-and-customizable-layouts.md` — blocked by none
- `docs/plans/slices/02-workspace-branding-on-web-and-mobile.md` — blocked by 01
- `docs/plans/slices/03-default-workspace-and-theme-preference.md` — blocked by none
- `docs/plans/slices/04-title-aligned-hierarchy-with-engineer.md` — blocked by none
- `docs/plans/slices/05-date-aware-timesheet-duplication.md` — blocked by none
- `docs/plans/slices/06-reliable-mobile-project-selection.md` — blocked by none
- `docs/plans/slices/07-desktop-keyboard-and-icon-polish.md` — blocked by none
- `docs/plans/slices/08-shared-team-hierarchy-view.md` — blocked by 04
- `docs/plans/slices/09-mobile-reference-data-administration.md` — blocked by 01
- `docs/plans/slices/10-mobile-people-and-hierarchy-administration.md` — blocked by 01, 04
- `docs/plans/slices/11-mobile-operational-administration.md` — blocked by 01
- `docs/plans/slices/12-mobile-privileged-reports-and-export.md` — blocked by 01

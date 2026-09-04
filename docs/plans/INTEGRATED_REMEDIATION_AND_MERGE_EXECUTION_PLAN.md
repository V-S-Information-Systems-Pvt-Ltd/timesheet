# Integrated Remediation, Merge, and Rollout Execution Plan

**Date:** 2026-09-04

**Status:** proposed; no merge, push, migration application, deployment, or bearer-auth enablement is authorized by this document

**Working branch at authoring:** `mobile-dev` @ `cec34b2`

**Upstream target at authoring:** `origin/main` @ `b6fc11d`

## 1. Objective

Prepare `mobile-dev` for a safe, reviewable merge into `main`, close the release-blocking migration and authorization gaps, make CI exercise the behavior it claims to cover, finish password-recovery acceptance work, and then complete the remaining code-quality and mobile-security gates in dependency order.

This document controls **execution order and checkpoints**. The source plans remain the detailed design references for their individual changes. If a source plan conflicts with the current repository or with another plan, stop the affected checkpoint, record the conflict, and resolve it explicitly rather than choosing a convenient interpretation.

## 2. Source-plan status and routing

| Document | How to use it |
| --- | --- |
| `MOBILE_DEV_TO_MAIN_MERGE_PLAN.md` | Active integration design, but its `mobile-dev@1b4f226` / `main@2a77608` baseline is stale. Revalidate every conflict and affected file before execution. |
| `MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md` | Active approval and live-environment evidence gate. Pending rows are not implementation-complete. |
| `CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md` | Active backlog. Its slice 1 is checkpoint CP3 below; slice 2 is CP4. Slices 3–8 are post-merge checkpoints CP9–CP14. |
| `FORGOT_PASSWORD_IMPLEMENTATION_PLAN.md` | The main implementation already exists from commit `7ccca38`. Use it as an acceptance checklist and implement only verified gaps. |
| `MOBILE_CODE_REVIEW_FINDINGS_FIX_PLAN.md` | Mostly superseded by later secure-storage commits and security notes. Retain the review-skill correction and operator cutover/evidence items. |
| `SECURITY_REVIEW_REMEDIATION_PLAN.md` | Code slices are substantially delivered. Use it for remaining live verification and rollout gates, not as a greenfield implementation list. |
| `SECURITY_REVIEW_REMEDIATION_NOTES.md` | Current evidence ledger. Its open items remain open until real environment/device evidence is recorded. |

## 3. Non-negotiable controls

1. Keep `MOBILE_BEARER_AUTH_ENABLED=false` in every environment until CP15 passes.
2. Never edit or rename an applied migration. Add a new migration only after its identity and placement are approved.
3. Never infer migration approval from a filename, commit, timestamp, or passing text-based test.
4. Never infer live database, installed-device, scheduler, HSTS, or proxy behavior from unit tests or source inspection.
5. Preserve all security and correctness changes from `origin/main`; do not resolve conflicts using blanket “ours” or “theirs”.
6. Treat `lib/db/native.ts` as the current authorization-parity authority unless a documented product decision says it is wrong.
7. Keep authorization-changing, migration, CI, and structural-refactor commits independently revertible.
8. Do not push, deploy, apply shared-environment migrations, revoke sessions, or enable bearer authentication without explicit authorization for that external action.
9. Do not expose secret values, raw reset tokens, refresh tokens, SMTP credentials, database URLs, or service-role keys in logs or evidence.

## 4. Coding-agent execution contract

### 4.1 Start procedure for every checkpoint

Before changing files:

1. Run `git status --short` and preserve unrelated user changes.
2. Record `git branch --show-current`, `git rev-parse HEAD`, and the relevant upstream ref.
3. Re-read the target hunk and the linked source-plan section.
4. Confirm the checkpoint's entry conditions and operator approvals.
5. List the intended files and tests in the checkpoint evidence entry.
6. If the branch, upstream, schema history, or relevant source has changed since the checkpoint was planned, re-scope before editing.

### 4.2 Finish procedure for every checkpoint

Before marking a checkpoint complete:

1. Run every targeted test named by the checkpoint.
2. Run the narrowest relevant lint/typecheck/build check.
3. Run `git diff --check`.
4. Run `git status --short` and confirm only intended changes remain.
5. Review the final diff for secret material, unrelated formatting, generated artifacts, and accidental migration edits.
6. Record exact commands, pass/fail/skip counts, commit SHA, deviations, and unresolved evidence.
7. Mark a checkpoint `Complete` only when all exit criteria are met. Use `Blocked` when a required approval, environment, or product decision is unavailable.

### 4.3 Evidence format

Append one entry per checkpoint to this document or a dedicated linked notes file:

```text
Checkpoint: CPx
Status: Not started | In progress | Blocked | Complete
Branch / HEAD:
Started / completed:
Files changed:
Commit:
Commands and results:
Unexpected skips:
Operator or live evidence:
Deviations:
Open items:
```

Unit/static, database-integration, browser-E2E, installed-device, and live-environment evidence must be labeled separately.

## 5. Checkpoint ledger

| Checkpoint | Description | Status | Blocks |
| --- | --- | --- | --- |
| CP0 | Rebaseline and record decisions | Partial (decisions approved; operator environment lineage matrix pending in CP6) | CP2, CP6 |
| CP1 | Merge current `origin/main` into `mobile-dev` | Complete | — |
| CP2 | Add the approved migration-convergence bridge | Implemented (approved; blocked on live convergence) | CP7, CP8 |
| CP3 | Scope Supabase leave/reminder access to the actor | Complete | — |
| CP4 | Make database and authenticated E2E checks execute in CI | Partial — CI sequencing defect fixed; awaiting green-run evidence | CP7 |
| CP5 | Close password-recovery acceptance gaps | Partial | CP7 |
| CP6 | Provision and record environment prerequisites | Blocked (operator) | CP15 |
| CP7 | Run the pre-merge acceptance matrix | Blocked despite local checks passing | CP8 |
| CP8 | Merge prepared `mobile-dev` into `main` | Local merge performed; release gate not satisfied | Remote push, deployment |
| CP9 | Complete the remaining `_actor` and parity sweep | Complete | CP10–CP12, CP15 |
| CP10 | Complete error hygiene and authentication-secret validation | Complete | CP11, CP15 |
| CP11 | Flip the Supabase default client to user-scoped access | Complete | CP12, CP15 |
| CP12 | Expand and ratchet coverage gates | Complete | Final completion |
| CP13 | Decompose mobile `SessionProvider` | Complete | Final completion |
| CP14 | Correct review skills and residual hygiene | Complete | Final completion |
| CP15 | Complete live security evidence and bearer rollout decision | Blocked (operator) | Bearer enablement |

## 6. Critical-path checkpoints

### CP0 — Rebaseline and record decisions

**Entry:** clean or explicitly accepted working tree.

**Work:**

1. Fetching remote changes is allowed only when explicitly requested or already available locally. Inspect the current local `origin/main` either way.
2. Recalculate the merge base, divergent commits, changed files, and conflict set. The old 8-file/12-hunk count is evidence from a previous baseline, not an invariant.
3. Include current `origin/main` commit `b6fc11d` and its server-side whitelisted-domain behavior in the analysis.
4. Record whether the release owner requires CP3 before the merge. This plan recommends **yes**.
5. Record the migration-version allocation decision for:
   - the committed but unapplied `20260911000000_rate_limits.sql`;
   - the committed but unapplied `20260911000001_pin_mobile_session_rotation.sql`;
   - the proposed table-existence bridge needed before `20260905030000`.
6. Complete the environment lineage, backup, migration-history, and live-function fields in `MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md` using operator evidence. (Probing and recording development/staging/production live environments requires operator credentials and infrastructure access, tracked under CP6).
7. Confirm `MOBILE_BEARER_AUTH_ENABLED=false` everywhere.

**Verification:**

- Current source and target SHAs are recorded.
- The conflict inventory names every changed file and flags security-bearing hunks.
- Approval records identify approver, date, allocation method, and exact permitted migration identity or placement rule.
- No shared environment was modified during discovery.

**Exit:** baseline, decisions, approvals, and environment classifications are recorded. Live environment backup and lineage verification are delegated to operator checkpoint CP6. If migration approval or lineage evidence is missing, CP2 and the release remain blocked.

### CP1 — Merge current `origin/main` into `mobile-dev`

**Entry:** CP0 conflict inventory complete.

**Work:**

1. Merge current `origin/main` into `mobile-dev` with a merge commit.
2. Preserve upstream writable-entry enforcement, standard confirmation behavior, and server-side whitelisted-domain validation.
3. Revalidate the old plan's conflict guidance before applying it:
   - combine dashboard user-selection behavior;
   - retain the current rate-limit test helpers while porting upstream assertions;
   - carry upstream backfill-window predicates into the batched native implementation;
   - retain the stricter `isAdminActor` edit rule;
   - union required imports and tests.
4. Do not add CP2 or CP3 behavior inside the merge-resolution commit.

**Targeted verification:**

```powershell
npx vitest run tests/confirm.test.ts tests/actions.test.ts tests/actions-extra.test.ts tests/native-repository.test.ts tests/supabase-daily-totals.test.ts tests/supabase-migrations.test.ts tests/supabase-whitelisted-domain.test.ts
npm run typecheck
```

**Exit:** no conflict markers; all current upstream commits are ancestors of the prepared branch; targeted tests pass.

### CP2 — Add the approved migration-convergence bridge

**Entry:** CP0 migration approval recorded; CP1 complete.

**Work:**

1. Add one approved, additive, idempotent `ensure_mobile_sessions` migration in the only ordering position that creates `public.mobile_sessions` before dependent migrations.
2. Include the table, required constraints, indexes, RLS enablement, and revokes from the original table migration.
3. Do not define `rotate_mobile_session` in this bridge.
4. Do not rename either branch's previously used versions.
5. Extend migration-text tests to guard uniqueness, idempotence, absence of the rotation function, and ordering before `20260905030000`.
6. Commit the migration and its tests separately from application changes.

**Targeted verification:**

```powershell
npx vitest run tests/supabase-migrations.test.ts
```

Apply the complete history to a clean disposable database and snapshots representing every discovered lineage. Text tests alone do not satisfy this checkpoint.

**Exit:** every lineage reaches the same schema; `mobile_sessions` exists before dependent migrations; the hardened rotation function and grants are correct.

### CP3 — Scope Supabase leave and reminder access to the actor

**Entry:** CP1 complete.

**Work:**

1. Port the native rules for `createLeaves`, `deleteLeave`, `listReminders`, `createReminder`, `updateReminder`, and `deleteReminder` into `lib/db/supabase.ts`.
2. Preserve the documented admin leave behavior.
3. Keep reminders own-only regardless of a caller-supplied user ID.
4. Add parity-oriented tests covering an authorized operation and a cross-user attempt for each method.
5. Keep raw PostgREST error hygiene out of this commit; it belongs to CP10.

**Targeted verification:**

```powershell
npx vitest run tests/supabase-repository-authz.test.ts tests/native-repository.test.ts
npm run typecheck
```

**Exit:** all known cross-user leave/reminder paths fail for unauthorized actors in both adapters, while legitimate own-user and admin behavior remains green.

### CP4 — Make CI execute database and authenticated E2E checks

**Entry:** CP1 complete.

**Work:**

1. Export the seeded admin through `E2E_EMAIL` and `E2E_PASSWORD` in the native E2E job.
2. Set `TEST_DATABASE_URL` to the job's PostgreSQL service and run the database concurrency/integration tests after migration.
3. Either seed `E2E_PENDING_EMAIL` / `E2E_PENDING_PASSWORD` or explicitly document the pending-user test as a manual/local check.
4. Keep the container build as a required job.
5. Correct stale security-report wording about the in-repo `vercel.json` without claiming live Vercel verification.

**Verification:** inspect CI output and record that the authenticated smoke test and database-backed tests ran. A green job containing an unexpected skip fails this checkpoint.

**Exit:** CI provides real SQL-layer, authenticated-browser, unit, coverage, mobile, and container evidence.

### CP5 — Close password-recovery acceptance gaps

**Entry:** CP1 complete. First compare current code and tests with `FORGOT_PASSWORD_IMPLEMENTATION_PLAN.md`; do not recreate delivered work.

**Work:** implement only missing behavior or proof. At minimum, determine and record coverage for:

1. malformed, unknown, inactive, repeated, rate-limited, cross-origin, and SMTP-failure requests with non-enumerating responses;
2. weak, malformed, expired, consumed, superseded, and concurrent reset-token submissions;
3. atomic rollback, exactly-one-winner behavior, `session_version` increment, and mobile-session revocation;
4. native JWT invalidation before/after reset;
5. Supabase `PASSWORD_RECOVERY`, update, revocation, global sign-out, and invalid-session paths;
6. request/reset page component and accessibility behavior;
7. mobile browser handoff validation and failure behavior;
8. Mailpit or equivalent native E2E, plus a configured Supabase smoke test;
9. token/password/SMTP-secret absence from responses and logs.

**Verification:** run each new targeted Vitest/Jest/Playwright test, then the root and mobile test suites affected by the changes.

**Exit:** every acceptance criterion is either evidenced or explicitly marked as an operator-only predeployment item. If `main` auto-deploys, CP5 is an unconditional prerequisite for CP8.

### CP6 — Provision and record environment prerequisites

**Entry:** may proceed in parallel with CP1–CP5; requires authorized environment access.

**Work per target environment:**

- provision a distinct `RATE_LIMIT_SUBJECT_SECRET` of at least 32 characters;
- provision `CRON_SECRET`;
- set `TRUSTED_PROXY_HOPS` from the real proxy topology;
- keep `MOBILE_BEARER_AUTH_ENABLED=false`;
- set the exact HTTPS `APP_BASE_URL`;
- configure native SMTP and verified sender settings;
- configure Supabase Site URL, exact reset redirects, SMTP, and recovery template;
- take recoverable database snapshots;
- record secrets as present/validated without recording their values.

**Exit:** every target has a completed configuration/evidence row. Missing secrets, unknown proxy topology, missing backup, or unverified reset redirects block release.

### CP7 — Run the pre-merge acceptance matrix

**Entry:** CP1–CP6 complete, except explicitly non-blocking installed-device evidence while bearer remains disabled.

**Automated verification:**

```powershell
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm --prefix mobile run lint
npm --prefix mobile run typecheck
npm --prefix mobile test -- --runInBand
git diff --check
git status --short
```

Run `npm run build` separately with `NEXT_PUBLIC_BACKEND=supabase` and `NEXT_PUBLIC_BACKEND=native` and the required placeholder configuration. Also require:

- database integration/concurrency tests against a migrated disposable PostgreSQL database;
- authenticated Playwright smoke execution;
- Docker image build;
- clean-database and historical-lineage Supabase migration convergence;
- live-function owner, `prosecdef`, `search_path`, ACL, rotation, and replay checks where operator access exists.

**Exit:** all required checks are green with no unexpected skips; `git status --short` contains only intended plan/evidence updates, if any.

### CP8 — Merge prepared `mobile-dev` into `main`

**Entry:** CP7 complete and explicit authorization to perform the final local merge.

**Work:**

1. Re-read `origin/main` immediately before merging. If it moved after CP1, return to CP0 and re-run the affected checkpoints.
2. Merge `mobile-dev` into `main` with `--no-ff`; do not squash.
3. Verify the expected commits and migration files are ancestors/present.
4. Re-run the targeted merge smoke tests and `git diff --check`.
5. Do not push or deploy unless those actions were separately authorized.

**Exit:** local `main` contains the reviewed merge commit and remains releasable under the recorded acceptance evidence.

## 7. Post-merge code-quality checkpoints

Execute CP9–CP14 as separate reviewable commits or pull requests. Run the start/finish procedure for every domain batch.

### CP9 — Remaining `_actor` scoping and adapter parity

Work in this order: timesheets → profiles → projects/activity types → leaves → settings/layouts → titles/whitelisted domains → super-admin lifecycle.

- Every repository method receiving an actor must enforce it or carry a justified actor-independence comment.
- Resolve `listTimesheets`, `listLeaves`, `listProfiles`, and `countTimesheetsByProject` in favor of the native behavior unless a product owner explicitly changes the contract.
- Add per-domain parity and failure-mode tests.
- Announce intentional visibility reductions before deployment.

**Exit:** no unexplained `_actor` parameters remain and both adapters have matching authorization outcomes.

### CP10 — Error hygiene and authentication-secret validation

- Map unknown Supabase write errors to generic client messages and log details server-side.
- Propagate/log subordinate lookup and swallowed audit/title errors appropriately.
- Require at least 32 characters for `AUTH_SECRET` and pin JWT verification to `HS256`.
- Remove silent report truncation and preserve RLS/actor scoping.
- Add a failure-mode test for each change.

**Exit:** raw provider/database errors cannot reach clients; authentication secret and algorithm rules are enforced.

### CP11 — Flip the Supabase default client to user-scoped access

- Change `server()` to use the user-scoped client.
- Use `getAdminClient()` only for enumerated service-role operations.
- Record and justify every remaining service-role call.
- Test a full authenticated journey in nonproduction for every permission and hierarchy role.

If this reveals a missing RLS policy, add a new migration. Never edit an applied migration. If RLS cannot be corrected safely, stop and retain adapter-level enforcement rather than forcing the flip.

**Exit:** user-scoped access is the default and the security advisor plus role matrix show no regression.

### CP12 — Expand coverage gates

- Expand coverage to the intended `lib/**` and `app/api/**` scope while excluding generated types.
- Introduce per-file thresholds at the level actually supported by behavioral tests.
- Do not satisfy thresholds with mock-interaction-only tests.

**Exit:** auth, repository, rate-limit, and route regressions cannot hide behind aggregate coverage.

### CP13 — Decompose mobile `SessionProvider`

- Remove duplicated per-action 401/refresh/retry logic in favor of the central single-flight client behavior.
- Extract domain action groups behind the existing context interfaces without screen churn.
- Preserve public context types and behavior.
- Prove that concurrent 401 responses trigger exactly one refresh.

**Exit:** mobile lint, typecheck, and full Jest suite pass; session behavior is unchanged except for the removal of duplicated retry paths.

### CP14 — Correct review skills and residual hygiene

When `.agents/skills/` is writable:

- mark `MemoryTokenStore` as test-only and reject plaintext/silent production fallbacks;
- allow documented CSV/204 success responses instead of requiring JSON universally;
- prohibit Node built-ins in mobile runtime modules, not Node-only build scripts;
- require platform behavior to flow through `mobile/src/platform/`.

Also remove the stale lint import, correct the hierarchy-role comment, and extend axe coverage to the dashboard and a dialog.

**Exit:** the workspace review instructions cannot approve insecure storage or reject valid streaming/tooling code, and residual checks are green.

## 8. CP15 — Live security evidence and bearer rollout decision

This checkpoint is operator-led and may gather evidence in parallel, but it completes only after CP3, CP6, CP9, CP10, and CP11.

Required evidence:

1. Android, iOS, and Windows installed-build secure-store write/read/delete, process-restart restoration, and logout deletion.
2. Authorized, recorded revocation of all pre-cutover mobile sessions.
3. Live Supabase rotation, replay detection, family revocation, function ownership, `prosecdef`, `search_path`, and grants.
4. Parallel-worker rate-limit integration behavior.
5. Successful cleanup scheduler runs in every deployment topology.
6. Live HSTS headers, HTTPS behavior, and real client-IP resolution.
7. Native and Supabase password recovery smoke tests without secret material in evidence.

Only after every applicable row passes may the release owner approve `MOBILE_BEARER_AUTH_ENABLED=true` for that environment. Enable one nonproduction environment first, run the complete mobile session journey, and promote progressively.

## 9. Recommended commit sequence

Exact commits may be split further, but do not combine the categories below:

1. `chore(merge): merge main into mobile-dev`
2. `fix(db): ensure mobile_sessions exists before dependent migrations`
3. `fix(db): scope supabase leave and reminder writes to the actor`
4. `test(ci): execute database and authenticated e2e checks`
5. Focused `fix(auth)` / `test(auth)` commits for verified password-recovery gaps
6. Final `--no-ff` integration merge into `main`
7. Per-domain `fix(db)` commits for the parity sweep
8. `fix(auth): harden session verification and error handling`
9. `refactor(db): default supabase repository to user-scoped access`
10. `test(coverage): expand backend quality gates`
11. `refactor(mobile): decompose session provider actions`
12. `fix(skills): align review rules with runtime contracts`
13. `test(a11y): expand authenticated accessibility coverage`
14. `docs(security): record final rollout evidence`

## 10. Global stop conditions

Stop the affected checkpoint and request direction when any of the following occurs:

- the working tree contains overlapping unexplained changes;
- `origin/main` moves after conflict analysis;
- migration identity, ordering, backup, or lineage is unapproved/unknown;
- a migration would need to be renamed or edited after application;
- a parity difference appears intentional but lacks a product decision;
- a required CI integration or E2E test skips;
- a live migration result differs from the recorded lineage model;
- an RLS gap prevents a safe user-scoped client flip;
- proxy topology, TLS support, signing access, device access, or deployment access is unavailable;
- bearer enablement is requested before CP15;
- completion evidence would require retaining credentials or token material.

## 11. Definition of complete

This integrated plan is complete only when:

- CP0–CP14 are marked complete with commit and verification evidence;
- `main` contains the non-squashed integration history;
- clean and historical database lineages converge safely;
- both adapters enforce matching authorization rules;
- CI executes the authenticated browser and database integration paths without unexpected skips;
- password recovery is verified in native and Supabase modes;
- all live/device evidence in CP15 is recorded per environment;
- bearer authentication remains disabled where any CP15 row is incomplete;
- the final working tree is clean and contains no scratch or probe artifacts.

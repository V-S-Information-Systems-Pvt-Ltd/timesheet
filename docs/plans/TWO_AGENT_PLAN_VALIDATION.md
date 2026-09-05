# Validation — "Two-Agent Implementation Plan"

**Subject:** an externally-supplied plan proposing Gemini 3.8 Flash + GLM 5.3 Flash as a two-agent remediation pair, with waves CP0–CP4 and 15 branches.
**Validated against:** `main` @ `910806a`, working tree as of 2026-09-06.
**Governing document already in repo:** [`docs/plans/ARCHITECTURE_REMEDIATION_PLAN.md`](ARCHITECTURE_REMEDIATION_PLAN.md) — CP17→CP22, 12 branches, baseline `86a963c`.

## Verdict

The two-agent plan's defect list is broadly real — I re-verified each headline claim against source and most hold. But it is **not adoptable as written**, for one structural and four substantive reasons:

1. It duplicates an active, already-verified plan in this repo, at lower resolution, with colliding checkpoint numbers.
2. It repeats three claims that the existing plan already disproved against source (Part 2 below), so ~1.5 of its work items are partly or wholly already shipped.
3. It omits two documented traps that will make a "passing" fix break production (Part 3).
4. It silently drops the hardest item in the mobile stream — the native Kotlin/Swift/C++ KV surface — leaving its own mobile fix non-functional on device.
5. Its agent selection is contradicted by the benchmark table it cites (Part 4).

Recommendation: keep `ARCHITECTURE_REMEDIATION_PLAN.md` as the plan of record. Adopt from the two-agent plan only the four genuinely new work items (Part 6) and, if a two-agent constraint is real, the corrected allocation in Part 7.

---

# Part 1 — The structural problem: a plan of record already exists

`ARCHITECTURE_REMEDIATION_PLAN.md` covers the same defects with tighter scoping, file-level conflict analysis, and per-task acceptance criteria. Mapping:

| Two-agent plan branch | Existing plan | Status of the overlap |
|---|---|---|
| `fix/client-ip-policy` | T17.1 `fix/trusted-proxy-fail-fast` | Existing scope is correct; two-agent version is **wrong** (Part 3.1) |
| `fix/auth-session-revocation` | T17.2 `fix/password-change-revocation` | Two-agent version **misses the trap** (Part 3.2) |
| `fix/mobile-auth-gate` | T17.3 `fix/mobile-bearer-gate` | Equivalent; existing adds the default-value decision |
| `perf/import-daily-totals` | T18.1 `perf/scoped-import-totals` | Two-agent version **rewrites SQL that already exists** (Part 3.3) |
| `fix/report-server-filtering` | T18.2 `fix/reports-server-date-range` | Two-agent version over-scopes a one-file fix (Part 3.4) |
| `fix/branding-csp` | T18.3 `feat/branding-logo-proxy` | **Orphaned** in the two-agent plan — listed in its §6, never assigned |
| (in its §19 "cleanup") | T18.4 `perf/branding-request-cache` | Misclassified as cleanup; it is a 3×-per-render query |
| `feat/supabase-atomic-restore` | T19.1 `fix/supabase-restore-atomicity` | Two-agent version **misses half the defect** (Part 3.5) |
| `fix/mobile-persistence` | T20.1 `feat/mobile-kv-seam` | Partly already shipped; see Part 2 #3 |
| *(absent)* | T21.1 `feat/mobile-kv-native` | **Dropped.** Without it, T20.1/`fix/mobile-persistence` cannot persist |
| (in its §19 "cleanup") | T21.2 `perf/admin-create-returning` | Misclassified — it is a race condition, not cleanup |
| `refactor/timesheet-domain-service` | T22.1 `refactor/timesheet-domain-service` | Same name, same scope, compatible ordering |

Also: the two-agent plan numbers its checkpoints CP0–CP4 and tags `checkpoint/cp1-critical-correctness`. This repo's series already runs CP0–CP16 (archived evidence ledger) and CP17–CP22 (active plan). Reusing CP0–CP4 for new content makes the tag history unreadable.

---

# Part 2 — Claim-by-claim verification

Re-verified against source at `910806a`, not taken from either plan.

| # | Two-agent plan claim | Verified | Evidence |
|---|---|---|---|
| 1 | Reports table filters a capped 1,000-row set client-side | **True** | `app/reports/page.tsx:18` `PAGE_SIZE = 1000`; `:145`, `:160`, `:175` call `getTimesheets({ from, to })` with no date params; `:215`, `:310`, `:337-338` filter via `selectRows(...)` |
| 2 | Import runs an unfiltered `GROUP BY` over all timesheets | **True** | `app/actions/import-backup.ts:122` calls `repo.getTimesheetDailyTotals(actor)`. But see Part 3.3 — the scoped primitive already exists |
| 3 | Mobile storage is volatile | **Partly stale** | `workspace-store.ts:1,38-39,107,184` now has a `NativeModules.VsisSecureStorage` first tier (commit `7006dcc`). Still broken: `offline-queue.ts:94` `private inMemory = new Map(...)` with only a `localStorage` tier, and `theme-store.ts:32,57,99` (`localStorage` + `scope.require('fs')`). React Native has neither, so the queue silently no-ops |
| 4 | Supabase restore is not transactional | **True, and understated** | `lib/db/supabase.ts` restore path has no `begin`/`commit`. Native is correct at `lib/db/native.ts:1206-1294`. See Part 3.5 for the omitted half |
| 5 | `MOBILE_BEARER_AUTH_ENABLED` is not enforced | **True** | Read only at `app/api/v1/config/route.ts:8`. `app/api/v1/_http.ts` — which hosts `requireMobileActor` — never reads it |
| 6 | `direct-client` global identity fallback exists | **True, but the fix is wrong** | `lib/ip.ts:103`. `deploy/configmap.yaml:15` already sets `TRUSTED_PROXY_HOPS: "1"`; `.env.example:54` has it commented out; `docker-compose.yml` omits it entirely. Only the compose/bare path is exposed |
| 7 | Password change does not invalidate sessions | **True** | `lib/auth/native.ts:124` writes `update public.profiles set password_hash = $1 where id = $2` and nothing else |
| 8 | Web and mobile duplicate timesheet rules | **True** | `app/actions/timesheets.ts` and `lib/api/v1/services/timesheets.ts` are independent implementations |
| 9 | `Repository` is an oversized interface ("40+ operations") | **True, understated** | `lib/db/repository.ts:227` declares ~80 members across 451 lines; adapters are 1,788 and 1,813 lines |
| 10 | No server-side idempotency for replayed mobile mutations | **True** | No `Idempotency-Key`, `idempotency`, or `client_mutation` handling anywhere in `app/`, `lib/`, `db/`. The client already mints an id (`offline-queue.ts` `mut_…`), so the missing half is server-side |
| 11 | Mobile Jest must be part of every gate | **True and available** | Verified live: `npx jest __tests__/home-screen.test.tsx` passes in `mobile/`. 43 suites present. The `react-test-renderer .act` breakage recorded in the archived CP7 ledger is resolved on this branch |

---

# Part 3 — Substantive defects in the two-agent plan

These are the findings that would cause real damage if the plan were executed as written.

## 3.1 `CLIENT_IP_MODE` duplicates an existing variable and re-opens a closed hole

The plan (§10.2 Branch B) proposes a new `CLIENT_IP_MODE=direct|trusted-proxy` plus `TRUSTED_PROXY_HOPS=N`. `TRUSTED_PROXY_HOPS` already exists and is already wired (`lib/ip.ts:52`, `deploy/configmap.yaml:15`). Adding a second, overlapping switch creates a state matrix where `CLIENT_IP_MODE=direct` with `TRUSTED_PROXY_HOPS=1` has no defined meaning.

Worse, the plan frames the objective as "remove the `direct-client` fallback." That fallback is **correct** — it is the fail-closed value. `lib/ip.ts` deliberately refuses to trust leftmost `x-forwarded-for`; changing that would introduce spoofable rate-limit subjects. The actual defect is that the misconfiguration is *deployable*: with `TRUSTED_PROXY_HOPS` unset in production, every user shares one rate-limit subject, so the four IP-only buckets collapse org-wide:

- `app/api/auth/domain-check/route.ts:20` → `domaincheck:${ip}`, 10/hour — fires from inline signup-form validation, so ten interactions per hour disable signup validation for everyone
- `app/api/auth/signup/route.ts:59` → `signup:${ip}`, 10/hour
- `app/api/v1/auth/signup/route.ts:52` → byte-identical subject, so web and mobile share one budget
- `app/api/auth/reset-password/route.ts:35` → `password-reset-complete:${ip}`, 10/hour

Login and change-password are unaffected — they key per identity. The correct fix is T17.1: make the unsafe configuration refuse to boot, fix `docker-compose.yml` and `.env.example:54`, and leave `lib/ip.ts` logic byte-for-byte unchanged.

## 3.2 The session-revocation fix will 401 the user who just changed their password

The plan's §10.2 Branch A required tests are: old web session rejected, old refresh token rejected, new login accepted. All three can pass while the feature is broken.

`getSessionUserImpl()` rejects any cookie whose `sessionVersion` ≠ the DB `session_version`. The moment `changePassword` bumps `session_version`, the **caller's own** cookie is stale and they are 401'd on their next request. `changePassword` must return the new `sessionVersion`, and both `app/api/auth/change-password/route.ts` and `app/api/v1/auth/change-password/route.ts` must re-issue the cookie via `signSessionToken` + `setSessionCookie` before responding.

The missing fourth test — *the caller's own subsequent request still authenticates* — is the one that catches this. Add it, plus a fifth: a forced revocation failure must leave `password_hash` unchanged, which requires the revocation to run inside the same transaction as the hash write. `lib/db/password-recovery.ts:93-116` is the proven shape; `lib/db/pool.ts` exports a `transaction()` helper.

## 3.3 The import fix proposes new SQL for a primitive that already exists

The plan (§15.2) proposes writing `WHERE user_id = ANY($1) AND log_date BETWEEN $2 AND $3`, then notes "for large sparse imports, exact `(user_id, date)` matching may be preferable."

Exact pair matching already exists in both adapters: `sumHoursForUserDates(actor, userDatePairs)` at `lib/db/native.ts:1421` (an `unnest($1::uuid[], $2::text[])` join) and `lib/db/supabase.ts:1408`, declared at `lib/db/repository.ts:282`. The `out: TimesheetInput[]` array already in scope at the call site holds every `{userId, logDate}` pair it needs. This is a call-site swap, not a query-design task, and the plan's `EXPLAIN (ANALYZE, BUFFERS)` step is measuring a query nobody needs to write.

The plan also misses the more serious half: in Supabase mode the current path reaches for `getAdminClient().rpc('get_timesheet_daily_totals')` because `supabase/migrations/20260902000000_restrict_totals_rpc.sql` revoked the RPC from `authenticated`. That is a service-role read of every user's hours — precisely what `AGENTS.md` forbids. This is an authorization finding sitting inside a branch the plan labels `perf/`, and the RPC should be dropped by a new migration as part of the fix.

## 3.4 The reports fix is over-scoped

The plan (§13.1) proposes a canonical `ReportFilter` interface and moving filtering, sorting, authorization, aggregation, and pagination "to server/database boundaries," shared across web report, CSV export, and comparison report.

`TimesheetQuery` already supports `dateFrom`/`dateTo` in both adapters — `lib/data/client.ts:19-20`, `:111-112` (`.gte`/`.lte`) and `:320-321` (`params.set`). No client, API, or repository change is required; the fix is passing `range.start`/`range.end` into the existing call in one file.

The plan also misses the asymmetry that makes this a data-trust bug rather than a performance bug: **CSV export is already server-filtered and correct.** The on-screen table and the exported file can disagree for the same range, and the file is the one that is right. That is the sentence that should be in the PR description.

## 3.5 The restore fix addresses atomicity but not the lie

The plan (§13.3) correctly targets "avoid JavaScript pseudo-transactions." Two problems.

First, its premise about the current implementation is stale in the same way the input report was: the Supabase restore already batches (`BATCH_SIZE = 50`) and already scopes its pre-reads with `.in('user_id', …).in('log_date', …)` plus `.range()` paging. Nothing in the plan needs to add batching.

Second, and more dangerous: on a mid-stream batch failure the function returns `{ ...empty, error }` — `created` counts of **zero** — while earlier batches are already committed (`lib/db/supabase.ts:1189` is the `empty` literal). The operator is told "failed, nothing created" when N×50 rows landed, and the audit log records nothing. A natural response is to re-run, double-inserting. The plan's required test ("database must equal pre-restore state") only covers the transactional happy path; if the transactional rewrite is judged too large, the plan has no fallback and would leave the misreporting in place. Honest partial-commit reporting must be a stated requirement, not a consolation prize.

## 3.6 The mobile persistence stream cannot work as scoped

The plan's §10.1 checkpoints G1.1–G1.6 are entirely JavaScript: abstraction, workspace, theme, queue, idempotency, unit tests. Two problems.

`mobile/package.json` has no AsyncStorage and no MMKV. The only durable surface available is `NativeModules.VsisSecureStorage`, which today exposes fixed-purpose methods (`read`/`write`/`clear`/`clearLegacy`) plus the workspace trio added by `7006dcc`. There is **no generic key/value method** on any platform. A JS-only seam therefore has nothing to bind to, and `offline-queue.ts` stays in-memory on device while its Jest tests pass under Node.

That native work — `readItem`/`writeItem`/`removeItem` in Kotlin, Swift (+ `RCT_EXTERN_METHOD` bridge entries), and C++ `PasswordVault` — is T21.1, the highest-risk item in the existing plan, and the two-agent plan does not contain it at all. It also carries a platform contract the plan must not "fix": Windows cannot resolve `null` on `ReactPromise<std::string>` and returns `""` for a missing entry while iOS and Android resolve `null` (documented at `mobile/src/platform/secure-storage/native.ts:124-131`).

Separately, G1.2 (workspace persistence) is already shipped and should be dropped; the remaining stores are `offline-queue.ts` (High) and `theme-store.ts` (cosmetic).

## 3.7 Two items are misfiled as low-risk cleanup

The plan's §19 lists "deduplicate `getBranding()`" and "`INSERT … RETURNING`" under Wave 5 cleanup with the instruction "do not refactor merely to reduce LOC."

- `app/layout.tsx` calls `repo.getBranding()` three times per render (`generateMetadata`, `generateViewport`, `RootLayout`), each in its own try/catch. That is three identical queries on every SSR page load — a per-request cost, not tidiness. Note that React `cache()` memoises rejections too, so each site's fallback to `DEFAULT_BRANDING` has to survive the change.
- The admin create path (`app/api/v1/admin/projects/route.ts`) does create → list → `find(p => p.name === name)` → optional setters → list again → find again. The name-based lookup is **racy**: two concurrent creates with the same name can return each other's row. That is a correctness defect, and it belongs in a security/backend stream, not cleanup.

## 3.8 `fix/branding-csp` is declared and never assigned

The branch appears in the plan's §6 branch tree and then in no wave, owner table, or task list. The work behind it (T18.3) is a same-origin logo proxy whose substance is SSRF control — private/loopback/link-local rejection, manual redirect handling with per-hop re-validation, body-size cap, timeout, content-type allowlist — because `logoUrl` is admin-supplied and the fetch originates inside the network. It is not a config tweak, and `next.config.ts` has no `images.remotePatterns`, so `next/image` is not a shortcut. Adding `https:` to CSP `img-src` is the wrong fix; it weakens the policy for a cosmetic feature.

---

# Part 4 — The agent selection is contradicted by its own table

The two-agent plan's §2 presents this as the justification for promoting GLM 5.3 Flash to co-lead:

| Model | Terminal-Bench 2.1 | DeepSWE |
|---|---:|---:|
| Gemini 3.8 Flash | ~89.4 | "strong" |
| GLM 5.3 Flash | 84.3 | 63.4 |
| DeepSeek V4 Flash 0731 | 82.7 | 54.4 |

Set against the fuller table already recorded in `ARCHITECTURE_REMEDIATION_PLAN.md` §3.1 — where the DeepSeek figures match exactly, so both tables draw on the same source — GLM 5.3 Flash ranks **fourth of five on both cited benchmarks**:

| Agent | DeepSWE | Terminal-Bench 2.1 |
|---|---:|---:|
| Muse Spark 1.3 | 75.4 | 88.8 / 89.2 |
| Gemini 3.8 Flash | 74 ±1 | ~89–91 |
| GPT-5.6 Luna | 67.2 | 84.7 |
| **GLM 5.3 Flash** | **63.4** | **84.3** |
| DeepSeek V4 Flash 0731 | 54.4 | 82.7 |

Three consequences follow.

**The promotion has no basis in the cited data.** GLM is behind Muse, Gemini, and Luna on long-horizon repo engineering and on terminal-agent performance, and ahead only of DeepSeek. The plan's §2 assertion that GLM "is strong enough that it changes the previous cost/capability allocation" is not supported by the numbers printed directly above it. GLM also has no CyberGym or comparable security score — which was the entire justification for routing security-invariant work to DeepSeek — so assigning GLM "authentication, SQL, Supabase RPC, authorization, security review" rests on subject-matter stereotype, exactly what the existing plan's §3.3 rubric was built to avoid.

**The hardest comprehension work lands on the weakest measured comprehender.** By dropping Muse Spark to escalation-only, the plan reassigns T22.1 (reconciling two independent timesheet implementations), T18.1 (deleting an interface member across ~9 files including test mocks and docs), and T19.1 (replicating native restore semantics in SQL) to Gemini — whose SWE-Atlas codebase-understanding score of 51.9 is the lowest of the three agents measured on it, against Muse's 59.4, and whose long-context retrieval is unmeasured against Muse's 98.5/98.1. These three tasks are the plan's own critical path.

**The cost premise is asserted.** §28 opens "Given Gemini is your cheapest model" and sets a 60–70 / 30–40 token split. No cost or latency data appears in either table, and `ARCHITECTURE_REMEDIATION_PLAN.md` §3.1 states explicitly that none was supplied. A token-share target is also not actionable: it cannot be checked before the work is allocated, and it cannot be corrected after.

**Not a criticism:** the two-stream shape — application/architecture in one lane, backend/security in the other — is sound for this codebase, and §27 is right that `lib/db/native.ts`, `lib/db/supabase.ts`, and `app/actions/*` are tightly coupled. The escalation ladder in §29 (two attempts, then hand off) is also a reasonable operating rule. The problem is which two agents, and on what evidence.

---

# Part 5 — What two agents actually costs

The plan's §27 argues two agents reduce integration risk versus four: "many branches → many merge points → more integration risk."

That is not what the file-level analysis shows. `ARCHITECTURE_REMEDIATION_PLAN.md` §4.2 establishes that branches *within* a checkpoint touch disjoint files, and enumerates the only five cross-checkpoint contentions with resolutions. Merge risk is a function of file overlap and checkpoint ordering, both of which are fixed by the branch map — not of how many agents hold the branches. Collapsing four lanes into two does not remove a single merge point; the same 12 branches still land.

What it actually changes is throughput. CP18 is four conflict-free branches, so it is the one checkpoint with genuine 4-wide parallelism; with two agents it serialises into two passes. CP17 is 3-wide. CP19, CP20, CP22 are single-branch by construction, so nothing is lost there.

The real gain from two agents is continuity — fewer context handoffs, and each agent accumulating familiarity with one half of the system across checkpoints. That is a defensible trade. It should be argued on those terms rather than on a risk reduction that the conflict matrix does not support.

---

# Part 6 — What the two-agent plan adds that is genuinely new

Four items are not in CP17–CP22 and are worth adopting as a CP23+ series, after the existing plan completes:

| Item | Two-agent plan ref | Assessment |
|---|---|---|
| Backend contract/parity tests (native vs Supabase) | §15.3 | **Adopt, and pull earlier.** `tests/mobile-contract-parity.test.ts` exists but does not cover the repository surface. These tests are the safety net that makes repository decomposition possible; the plan is right that decomposition must not start before they exist |
| Authorization parity matrix (native SQL vs Supabase RLS) | §17.2 | **Adopt.** Note the plan's own caveat is correct and important: roles here are two independent axes — `permission_role` (admin\|pm\|co\|user) × `hierarchy_role` (manager\|team_lead\|engineer\|user) — so its example matrix with a single `role` column does not describe this schema. Derive the matrix from source |
| Repository decomposition into per-domain contracts | §17.1 | **Adopt, sequence last.** ~80 members over 451 lines with 1,788/1,813-line adapters justifies it. The plan's own gate — parity tests first, structure-only diff, no behaviour change — is the right discipline |
| Observability harness | §17.3 | **Adopt, lowest priority.** Its "avoid high-cardinality labels" caution is appropriate |

One item to add that neither plan has: **server-side idempotency** for replayed offline mutations. The mobile client already mints a mutation id; nothing on the server consumes it. Durable queue persistence (T20.1/T21.1) converts a data-loss bug into a duplicate-submission bug unless the server dedupes. This belongs in the backend stream, landing with or before the durable-queue work — not inside the mobile branch, where the two-agent plan places it.

---

# Part 7 — Corrected allocation, if the two-agent constraint is real

Keep the 12 branches, gates, and merge order from `ARCHITECTURE_REMEDIATION_PLAN.md` — only the owner column changes. Rule numbers refer to that document's §3.3.

## 7.1 Recommended pair: Gemini 3.8 Flash + Muse Spark 1.3

On the available data this is the only defensible two-agent pair: Gemini leads Terminal-Bench (~89–91), Muse leads DeepSWE (75.4), SWE-Atlas (59.4), and long-context (98.5 / 98.1). They are complementary; Gemini + GLM is not (§4).

| Branch | CP | Owner | Rule | Why |
|---|---|---|---:|---|
| `fix/trusted-proxy-fail-fast` | 17 | Gemini | 3 | Boot check, compose, env, deploy docs |
| `fix/password-change-revocation` | 17 | Muse | 2 | Trap spans two routes plus cookie re-issue |
| `fix/mobile-bearer-gate` | 17 | Gemini | 4 | One predicate across six named routes |
| `perf/scoped-import-totals` | 18 | Muse | 2 | Interface-member deletion across ~9 files |
| `fix/reports-server-date-range` | 18 | Gemini | 4 | One file, fix already identified |
| `feat/branding-logo-proxy` | 18 | Muse | 2 | SSRF design; no security-benchmarked agent available |
| `perf/branding-request-cache` | 18 | Gemini | 4 | Three named call sites |
| `fix/supabase-restore-atomicity` | 19 | Muse | 2 | Native adapter held in context as the spec |
| `feat/mobile-kv-seam` | 20 | Muse | 2 | Requires all four stores in context at once |
| `feat/mobile-kv-native` | 21 | Gemini | 3 | Kotlin/Swift/C++ against three platform SDKs |
| `perf/admin-create-returning` | 21 | Gemini | 4 | Named pattern, `insert … returning` |
| `refactor/timesheet-domain-service` | 22 | Muse | 2 | Most comprehension-bound task in the plan |

Six branches each. Every agent reviews the other's branches; per §3.3 review is not a split.

**Accepted residual risk:** T17.2 and T18.3 lose their security-benchmarked owner. Neither Gemini nor Muse has a CyberGym-equivalent score, so both become peer-reviewed-by-generalist rather than owned-by-specialist. If a third agent is available for anything, make it security review on those two branches only.

**Parallelism:** CP17 and CP18 run 2-wide. CP21 serialises (both Gemini), which costs little because T21.1 already depends on CP20 merging. CP19, CP20, CP22 are single-branch by construction.

## 7.2 If GLM 5.3 Flash is mandated

Then the allocation must be the **inverse** of what the two-agent plan proposes. GLM has no codebase-understanding, long-context, or security benchmark in either table, and trails Gemini on both metrics it does have. It therefore takes the bounded, fully-specified work, and Gemini takes the comprehension spine:

- **GLM:** `fix/trusted-proxy-fail-fast`, `fix/mobile-bearer-gate`, `fix/reports-server-date-range`, `perf/branding-request-cache`, `perf/admin-create-returning`
- **Gemini:** `fix/password-change-revocation`, `perf/scoped-import-totals`, `feat/branding-logo-proxy`, `fix/supabase-restore-atomicity`, `feat/mobile-kv-seam`, `feat/mobile-kv-native`, `refactor/timesheet-domain-service`

State the consequence plainly: Gemini becomes the sole owner of the entire critical path (CP18 → CP19 → CP20 → CP21 → CP22), so the program stalls entirely if it is slow or unavailable, and its weakest measured dimension (SWE-Atlas 51.9) is loaded with the four most comprehension-bound tasks. That is a worse configuration than either §7.1 or the four-agent allocation. If GLM is mandated for cost reasons, get cost figures on the table first — neither plan has any.

---

# Part 8 — Verified environment facts

Recorded so no one re-derives them. All verified against `main` @ `910806a` in `C:\dev\timesheet`.

## 8.1 Locations the plans reference

| Fact | Location |
|---|---|
| Reports fetch, no date params | [app/reports/page.tsx:145](app/reports/page.tsx#L145), `:160`, `:175` — `getTimesheets({ from: 0, to: PAGE_SIZE - 1 })` |
| `PAGE_SIZE = 1000` | [app/reports/page.tsx:18](app/reports/page.tsx#L18) |
| Client-side filtering to replace | [app/reports/page.tsx:215](app/reports/page.tsx#L215), `:310`, `:337-338` — `selectRows(...)` |
| Date params already plumbed end to end | [lib/data/client.ts:19-20](lib/data/client.ts#L19) (types), `:111-112` (`.gte`/`.lte` on `log_date`), `:320-321` (`params.set('dateFrom'…)`) |
| Scoped totals primitive already exists | `Repository.sumHoursForUserDates` — [lib/db/repository.ts:282](lib/db/repository.ts#L282); native [lib/db/native.ts:1421](lib/db/native.ts#L1421); supabase [lib/db/supabase.ts:1408](lib/db/supabase.ts#L1408) |
| Import calls the unscoped RPC instead | [app/actions/import-backup.ts:122](app/actions/import-backup.ts#L122) — `repo.getTimesheetDailyTotals(actor)` |
| `Repository` surface | [lib/db/repository.ts:227](lib/db/repository.ts#L227) — ~84 members, 451 lines |
| Native restore is transactional | [lib/db/native.ts:1206-1294](lib/db/native.ts#L1206) |
| Supabase restore is not | [lib/db/supabase.ts:1189](lib/db/supabase.ts#L1189) — zeroed `created` literal; no `begin`/`commit` anywhere in the method |
| Password change, no revocation | [lib/auth/native.ts:124](lib/auth/native.ts#L124) — bare `update … set password_hash` |
| Bearer flag read in exactly one place | [app/api/v1/config/route.ts:8](app/api/v1/config/route.ts#L8); [app/api/v1/_http.ts](app/api/v1/_http.ts) never reads it |
| `TRUSTED_PROXY_HOPS` inconsistency | [deploy/configmap.yaml:15](deploy/configmap.yaml#L15) = `"1"`; [.env.example:54](.env.example#L54) commented out; `docker-compose.yml` omits it |
| CSP `img-src` | [next.config.ts:57-59](next.config.ts#L57) — `'self' data: blob:` |
| Mobile store already partly fixed | [mobile/src/storage/workspace-store.ts:38-39](mobile/src/storage/workspace-store.ts#L38) native tier, `:107` tried first; `:126-142` localStorage and `:45`/`:148` `fs` tiers still present |
| Mobile stores not fixed | [mobile/src/storage/offline-queue.ts:94](mobile/src/storage/offline-queue.ts#L94) in-memory `Map`; [mobile/src/storage/theme-store.ts:32](mobile/src/storage/theme-store.ts#L32) `scope.require('fs')` |
| No durable-storage dependency | `mobile/package.json` — no AsyncStorage, no MMKV; `@rnx-kit/jest-preset` ^0.3.1, jest ^29.6.3 |

## 8.2 Gate

```
npm run lint && npm run typecheck && npm test && npm run test:coverage
NEXT_PUBLIC_BACKEND=supabase npm run build
NEXT_PUBLIC_BACKEND=native  npm run build
```

Constraints that bite in practice:

- Coverage thresholds are 60% lines/functions/statements over `lib/**`, `app/api/**`, `app/actions.ts`, with tighter per-file gates on security-relevant files. Deleting a covered `Repository` member (T18.1) moves the denominator — check coverage, not just tests.
- DB integration tests **skip silently** without `TEST_DATABASE_URL`. A green `npm test` does not mean the native adapter was exercised.
- Playwright boots the **production** server and needs a seeded `E2E_EMAIL` / `E2E_PASSWORD`. It is not a substitute for the unit gate.
- Vitest aliases `server-only` to `tests/helpers.ts`; `NEXT_PUBLIC_BACKEND` is compiled in at build time, which is why both builds are mandatory on any branch touching `lib/db/*`.
- `npm --prefix mobile test` is green — verified live (`npx jest __tests__/home-screen.test.tsx --runInBand` → 1 suite / 2 tests passed), and the archived CP-ledger records 43 suites / 219–222 tests / 0 failures at `86a963c`. Earlier notes describing a `react-test-renderer .act is not a function` failure are stale; do not budget repair work for it.

## 8.3 Working tree

At time of writing the tree has **staged, uncommitted renames** archiving most of `docs/plans/*` and `docs/security/SECURITY_REVIEW.md`. Land or discard that before branching, or every one of the 12 branches inherits it.

---

# Part 9 — Decisions required

Four decisions, in order. Nothing should be branched until the first two are answered.

**1. Which document is the plan of record?**
Recommendation: `ARCHITECTURE_REMEDIATION_PLAN.md`. It covers the same defect set at higher resolution, its checkpoint numbering continues the repo's existing CP0–CP16 ledger, and its branch map and conflict matrix already solve the merge-risk problem the two-agent plan cites as its motivation. The two-agent plan is then not a competing plan but an input to decision 2.

**2. Is the two-agent constraint real, and why?**
If it comes from cost, supply cost figures — neither document has any, and §28's "Gemini is your cheapest model" is asserted, not shown. If it comes from operational overhead (context handoffs, review latency, coordination), say so; that is a legitimate reason and it changes the answer. Then:

- Constraint is real, model choice free → adopt §7.1 (Gemini + Muse).
- Constraint is real, GLM mandated → adopt §7.2 and accept that Gemini becomes a single point of failure on the whole critical path.
- Constraint is not real → keep the four-agent allocation as written; nothing in this validation argues against it.

**3. Adopt the four genuinely new items?**
From Part 6, none are in the plan of record: the mobile session-revocation gap, the `'direct-client'` rate-limit-bucket collision, server-side idempotency for replayed offline mutations, and the parity test suites. Recommendation: schedule idempotency to land with or before CP20/CP21 (durable queue turns a data-loss bug into a duplicate-submission bug without it), and take the other three as CP23. Do not fold them into existing branches — they change those branches' conflict footprints.

**4. Confirm the two dropped scope items.**
`fix/branding-csp` appears in the two-agent plan's branch tree with no owner, wave, or task. It should not exist: widening CSP `img-src` to `https:` for a cosmetic feature is the wrong fix, and the correct fix is the same-origin proxy already scoped as T18.3. Confirm it is dropped. Second, `feat/mobile-kv-native` (T21.1) is absent from the two-agent plan entirely; without it the mobile persistence fix cannot persist on device, and its Jest suite will pass anyway through the Node `fs` tier. Confirm it is retained under whichever allocation is chosen.

---

## Summary

The two-agent plan is directionally correct about the defects and wrong about the process. Its technical claims mostly hold — three are stale or already fixed (§2). Its agent allocation is contradicted by its own benchmark table (§4). Its central risk argument does not survive contact with the existing branch map (§5). It omits two documented traps that would let all its required tests pass while the product breaks (§3.1, §3.2), and it drops the native module without which its flagship fix does not work (§3.5).

Keep the plan of record. If two agents is a hard constraint, re-own its 12 branches per §7.1. Fold in the four new items from Part 6 as CP23, with idempotency pulled earlier.





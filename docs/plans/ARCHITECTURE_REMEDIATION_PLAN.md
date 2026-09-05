# Architecture Remediation Plan — CP17 → CP22

**Input:** `docs/plans/CODEBASE_ANALYSIS_FOR_CHATGPT.md` (LLM-generated, unverified)
**Status of that input:** every headline claim was re-verified against source. 5 claims were wrong or stale — see Part 1. Do not work from the input report directly; work from this document.
**Date:** 2026-09-05 · **Baseline commit:** `86a963c`
**Checkpoint numbering:** continues the repo's existing CP0–CP16 series.

## How to use this document

Each task below is a self-contained work order: scope, files, acceptance criteria, verification command, and an assigned agent. One branch = one agent = one PR. Branches inside a checkpoint are conflict-free and may run fully in parallel; checkpoints are gates, not suggestions — do not start CP(n+1) work that depends on CP(n) until its gate is green.

Every PR must pass the standard gate (Part 6) because CI builds in **both** backend modes.

---

# Part 1 — Corrections to the input report

These change task scope, so they come first.

| # | Report claim | Verified reality | Effect on plan |
|---|---|---|---|
| 1 | DB-PERF #2: "missing composite index on `timesheets (user_id, log_date)`" | **False.** Already exists in both backends: `db/migrations/0008_perf_indexes.sql` and `supabase/migrations/20260822000000_perf_indexes.sql:4`. A unique variant was created in `0001:59` and intentionally dropped by `0005_multi_entries.sql:8` to allow multiple entries per day. `0018_index_cleanup_and_tuning.sql` adds `idx_timesheets_project_date` and `mobile_sessions_cleanup_idx`. | **Task dropped entirely.** |
| 2 | REL-01: Supabase restore is "unbatched sequential inserts" | **Mis-characterized.** `lib/db/supabase.ts:1187-1339` already batches (`BATCH_SIZE = 50`) and already scopes its pre-reads (`.in('user_id', …).in('log_date', …)` with `.range()` paging). The actual defect is different and worse: there is **no transaction**, and on a mid-stream batch failure the function returns `{ ...empty, error }` — i.e. `created` counts of **zero** — while earlier batches are already committed. The operator is told "failed, nothing created" when in fact N×50 rows landed, and the audit log records nothing. | Task **re-scoped** from "batch the inserts" to "atomicity + honest partial-commit reporting". |
| 3 | MOB-01: "mobile storage falls back to `localStorage`" | **~1/3 already fixed** by commit `7006dcc`. `mobile/src/storage/workspace-store.ts` now has a native-first chain via `NativeModules.VsisSecureStorage.readWorkspace/writeWorkspace/clearWorkspace`, and all three platforms implement it (Kotlin `VsisSecureStorageModule.kt`, Swift `VsisSecureStorage.swift`, C++ `VsisSecureStorage.h`). Still broken: `offline-queue.ts` (High — unsynced mutations lost on process death) and `theme-store.ts` (cosmetic). | Task **narrowed** to two stores, and re-framed as "extract the seam" rather than "add a fourth copy of the fallback chain". |
| 4 | SEC-01: blanket "High" severity | **Deployment-path-dependent.** `deploy/configmap.yaml:15` sets `TRUSTED_PROXY_HOPS: "1"`, so the K8s/OpenShift path is safe. `docker-compose.yml` omits it and `.env.example:54` has it commented out, so those paths are exposed. | Severity confirmed High **for the compose/bare path only**; fix includes making the unsafe path impossible rather than just documented. |
| 5 | Report metrics (file counts, LOC totals, "~40 endpoints") | Not verified. | Omitted from this plan. Do not repeat them in PR descriptions. |

---

# Part 2 — Architecture analysis

## 2.1 The system is three dualities stacked on each other

The codebase is organised around one idea repeated three times: *support two of something behind one interface*. It succeeded once, half-succeeded once, and failed once. Every finding in this plan is a symptom of which layer you are standing on.

**Spine A — backend duality (healthy).** `lib/db/repository.ts` defines the contract; `lib/db/index.ts` dispatches `IS_NATIVE ? nativeRepository : supabaseRepository`. The seam is real, both sides implement it, CI builds both. Writes return `DbWrite`; reads throw. When a bug appears here it appears in *one* adapter and the other is the reference implementation — which is exactly why REL-01 (Supabase restore has no transaction) is so visible: `lib/db/native.ts:1206-1294` does the same job correctly with `getPool().connect()` + `begin`. The native adapter is the spec for the Supabase one.

**Spine B — client duality (seam missing).** There are two client tiers — same-origin web (Server Actions + `app/api/data/*`, CSRF via `originCheck`) and Bearer-JWT mobile (`app/api/v1/*`) — but **no shared domain layer between them**. Business rules are therefore written twice: `app/actions/timesheets.ts` and `lib/api/v1/services/timesheets.ts` independently re-implement the same validation and authorization. This is not a style complaint; it is the direct cause of the plan's most expensive property: **SEC-02 is one bug with two exploit surfaces**, because `app/api/auth/change-password/route.ts` and `app/api/v1/auth/change-password/route.ts` both call the same defective `changePassword()`, and any fix must be verified twice. Every future auth rule pays this tax.

**Spine C — mobile persistence duality (failed by copy-paste).** `mobile/src/platform/secure-storage/native.ts` states the correct policy in a comment and enforces it: *"Native platform modules own persistence; JavaScript never falls back to files, browser storage, or memory."* It throws typed `SecureStorageError`s (`unavailable|locked|corrupt|read-failed|write-failed|delete-failed`). Then three sibling stores — `workspace-store`, `offline-queue`, `theme-store` — each hand-rolled the *opposite* policy: a three-tier `NativeModules → localStorage → Node fs` chain wrapped in `try {} catch {}` that swallows every error. Because the chain was duplicated rather than extracted, fixing it in `workspace-store` (commit `7006dcc`) fixed nothing else. On React Native there is no `localStorage`, so `offline-queue` silently persists to a `Map` and loses unsynced mutations on process death.

## 2.2 Root-cause pattern: excellent primitives, wrong call sites

The single most useful finding for planning purposes is that **three of the eight headline defects are already solved elsewhere in the repo**. The fix is to change a call site, not to design anything:

| Defect | Correct primitive that already exists | Wrong call site |
|---|---|---|
| PERF-01 — unfiltered `GROUP BY` over all timesheets on every CSV import | `sumHoursForUserDates(actor, pairs)` — `lib/db/native.ts:1421-1451`, `unnest($1::uuid[], $2::text[])` join, `where t.user_id = $3` when `!canSeeAllActor`; Supabase twin at `lib/db/supabase.ts:1408` | `app/actions/import-backup.ts:122` calls `repo.getTimesheetDailyTotals(actor)` and then builds `new Map(totals.map(...))` — while the `out: TimesheetInput[]` array in scope already holds every `{userId, logDate}` pair the scoped primitive needs |
| SEC-02 — password change doesn't invalidate other sessions | `lib/db/password-recovery.ts:93-116` — in one transaction: `session_version = session_version + 1`, then `update public.mobile_sessions set revoked_at = coalesce(revoked_at, $1) …` | `lib/auth/native.ts` `changePassword()` writes only `password_hash` |
| FE-01 — reports table fetches an unfiltered 1000-row page and filters in memory | `TimesheetQuery` already supports `dateFrom`/`dateTo` in **both** adapters: `lib/data/client.ts:111-112` (`.gte`/`.lte`) and `:320-321` (`params.set(...)`) | `app/reports/page.tsx:141-154` and `:170-198` call `getTimesheets({ from: 0, to: PAGE_SIZE - 1 })` with no date params; `:213-216` then filters via `selectRows(...)` client-side |

This split is what makes the plan parallelisable: these three are small, mechanically verifiable diffs suitable for fast/cheap agents. The genuinely hard items — transactional Supabase restore, the unified domain layer, mobile native KV contracts across Kotlin/Swift/C++ — need design judgement and go to the strongest agent.

## 2.3 Findings sharpened beyond the input report

**SEC-01 — the failure mode is org-wide self-DoS, and the report missed the easiest trigger.** `lib/ip.ts` correctly refuses to trust an unvalidated `x-forwarded-for`: with no Vercel headers and `TRUSTED_PROXY_HOPS` unset in production it returns the literal `'direct-client'` (`lib/ip.ts:103`). That is fail-*closed* for spoofing, but it means **every user shares one rate-limit subject**. Blast radius is exactly the IP-only subjects:

- `app/api/auth/domain-check/route.ts:20` → `domaincheck:${ip}`, bucket `daily-signup`, **10/hour**
- `app/api/auth/signup/route.ts:59` → `signup:${ip}`, **10/hour**
- `app/api/v1/auth/signup/route.ts:52` → `signup:${ip}` — *byte-identical subject to the web route*, so web and mobile signups share one 10/hour budget org-wide
- `app/api/auth/reset-password/route.ts:35` → `password-reset-complete:${ip}`, **10/hour**

Domain-check is the sharpest edge: it fires from the signup form's inline validation, so ten form interactions per hour disable signup validation for everyone. Login and change-password are **not** affected — they key per identity (`login:${normalized}:${ip}`, `mobile-login:${email}:${ip}`, `pwchange:${id}:${ip}`), so `direct-client` merely collapses the IP half of an already-unique subject. The fix must therefore *not* start trusting leftmost `x-forwarded-for`; it must make the misconfiguration undeployable.

**SEC-02 — the fix has a trap that will look like a regression.** `getSessionUserImpl()` rejects any cookie whose `sessionVersion` ≠ the DB `session_version`. So the moment `changePassword` starts bumping `session_version` (which it must), the caller's *own* cookie becomes stale and the user is 401'd immediately after a successful password change. `changePassword` must return the new `sessionVersion`, and **both** routes must re-issue the cookie (`signSessionToken` + `setSessionCookie`) before responding. A fix that omits this will pass a naive unit test and break the product.

**SEC-04 — a silent feature failure, not a crash, which is why it survived.** `next.config.ts:57-59` sets `img-src 'self' data: blob:`. `lib/branding.ts` validates `logoUrl` as `https://`, ≤2048 chars. `BrandMark` (`app/components/ui.tsx:553-579`) renders a plain `<img src={effectiveUrl}>` with an `onError` handler that falls back to `/brand/vsis-logo-compact.jpg`. CSP blocks the remote load, `onError` fires, the bundled logo appears — so a configured custom logo simply never shows and nothing is logged. Note `next.config.ts` has **no** `images.remotePatterns`, so switching to `next/image` is not a shortcut. Two options: widen CSP to `img-src … https:` (weakens the policy for a cosmetic feature), or proxy the logo same-origin through a new route so CSP stays strict. **Take the proxy** — it keeps `img-src 'self'`, but it introduces a server-side fetch of an admin-supplied URL and therefore needs SSRF controls (private/loopback/link-local address rejection, redirect cap, size cap, timeout, image content-type allowlist). That is design work, not a config tweak.

**SEC-03 — the kill switch is decorative.** `app/api/v1/config/route.ts:8` reports the mobile API as enabled via `process.env.MOBILE_BEARER_AUTH_ENABLED === 'true' && Boolean(process.env.MOBILE_AUTH_SECRET)`. `app/api/v1/_http.ts` — the file containing `requireMobileActor`, which every authenticated `/api/v1` route funnels through — **never reads that variable**. The flag advertises a rollout gate that does not gate anything; the mobile surface is live whenever `MOBILE_AUTH_SECRET` is set.

---

# Part 3 — Agent assignment model

## 3.1 Basis

Assignments are derived from supplied benchmark data (below), not from tier naming. **An earlier revision of this plan assumed "Flash" meant cheap/weaker and that Luna was the frontier model; the data inverts that, and 8 of 12 branches were re-assigned as a result.** Read 3.4 before overriding anything.

| Benchmark | Gemini 3.8 Flash | Muse Spark 1.3 | GPT-5.6 Luna | DeepSeek V4 Flash 0731 |
|---|---:|---:|---:|---:|
| DeepSWE v1.1 — long-horizon repo engineering | 74% ±1% | **75.4%** | 67.2% | 54.4% |
| Terminal-Bench 2.1 | **~89–91%** | 88.8 / 89.2 | 84.7% | 82.7% |
| SWE-Bench Pro | 61.6% | — | **62.7%** | — |
| Codebase understanding | SWE-Atlas 51.9% | **SWE-Atlas 59.4%** | — | NL2Repo 54.2% |
| Automation / tool workflow | strong (unscored) | AutomationBench **49.4%** | AutomationBench 14.9% | AutomationBench Public 25.1% |
| Long-context 256K–512K | — | **98.5%** | 41.3% | — |
| Long-context 512K–1M | — | **98.1%** | 41.3% | — |
| CyberGym | — | — | — | **76.7%** |
| Toolathlon | — | — | 53.4% | **70.3%** |

**Reading the table honestly.** Blanks are missing data, not zeros. `SWE-Atlas` and `NL2Repo` are different benchmarks and cannot be ranked against each other, so DeepSeek's codebase-understanding standing is genuinely unknown. `AutomationBench Public` (DeepSeek) is a different variant from `AutomationBench max` (Muse), so 25.1% vs 49.4% is not a clean comparison; Luna's 14.9% and Muse's 49.4% appear comparable and that gap is large. The `max`/`xhigh` suffixes imply effort settings, so harness configuration affects reproducibility. Gemini's 74% ±1% and Muse's 75.4% substantially overlap — **Muse's real separation is long-context (+57pp over Luna) and SWE-Atlas (+7.5pp over Gemini), not DeepSWE.** Luna's SWE-Bench Pro lead is 1.1pp, inside plausible noise; treat it as parity, not superiority. **No cost or latency data was supplied**, so nothing below is justified on price.

## 3.2 Derived profile → work class

| Agent | What the data says | Work class it owns here |
|---|---|---|
| **Muse Spark 1.3** | Best codebase understanding (59.4%) and near-perfect long-context retrieval (98.5 / 98.1) — 2.4× Luna. Best DeepSWE and AutomationBench. | The comprehension-heavy spine: reconciling two implementations, coordinated multi-file deletions, abstraction design. Anything requiring the whole picture in context at once. |
| **Gemini 3.8 Flash** | Top Terminal-Bench (~89–91%), strong DeepSWE (74%), strong automation. Weakest of the three measured on codebase understanding (51.9%). | Toolchain, build, deploy, config, and broad well-specified mechanical edits — execution where the target is named rather than discovered. |
| **DeepSeek V4 Flash 0731** | **Only agent with a CyberGym score, and it is high (76.7%).** Best Toolathlon (70.3%). But lowest DeepSWE by ~20pp (54.4%). | Security-invariant and adversarial-correctness work, SQL/transactions — **kept to small, explicitly-named file sets** so the long-horizon weakness cannot bite. |
| **GPT-5.6 Luna** | Best SWE-Bench Pro (62.7%, ~parity with Gemini). Otherwise last: DeepSWE 67.2%, Terminal-Bench 84.7%, long-context 41.3%, AutomationBench 14.9%. | Single-file, single-concern, fully-specified defect fixes — classic SWE-Bench shape. |

## 3.3 Assignment rubric

Ask in order; first match wins, except that rule 1 outranks everything.

1. **Does the task turn on a security or adversarial-correctness invariant, in a file set small enough to name in one line?** → **DeepSeek**. CyberGym 76.7% is the only hard security signal available, and bounding the file set neutralises its 54.4% DeepSWE. If the file set is *not* small, this rule does not fire — hand it to Muse and require DeepSeek as security reviewer.
2. **Must the agent hold two implementations, or a whole subsystem, in context to get it right?** → **Muse Spark**. Long-context 98.5 / 98.1 and SWE-Atlas 59.4 are its decisive margins. Never route this class to Luna (41.3% retrieval).
3. **Is it toolchain, build, native SDK, deploy, or config work?** → **Gemini**. Terminal-Bench ~89–91%.
4. **Is it >5 files of near-identical, fully-specified edits?** → **Gemini** (74% DeepSWE with a named target beats Muse's comprehension edge, which is wasted here).
5. **Is it one file, one concern, with the fix already identified?** → **Luna**. This is SWE-Bench Pro shape and its only measured strength.
6. **Anything left over** → **Muse Spark**, as the highest all-round scorer.

**Hard rules.** No task may be split across two agents — security *review* by a second agent is not a split. Where two tasks touch the same file they go in different checkpoints and merge in the Part 4.2 order.

## 3.4 Resulting allocation, and the levers to change it

| Agent | Branches | Shape of the load |
|---|---:|---|
| Muse Spark 1.3 | 4 | The serial hard spine: CP18 → CP19 → CP20 → CP22 |
| Gemini 3.8 Flash | 4 | CP17 ×2, CP18 ×1, CP21 ×1 |
| DeepSeek V4 Flash | 3 | One per checkpoint in CP17, CP18, CP21 |
| GPT-5.6 Luna | 1 | CP18, single file |

Two consequences you should decide on rather than inherit:

- **Luna receives 1 of 12 branches.** That is not a slight; it follows from the workload — 10 of these 12 tasks are multi-file, and Luna is last-placed on every multi-file-relevant metric while leading only on single-file SWE-Bench Pro by 1.1pp. **Lever:** if you want Luna carrying more, T18.4 (tiny, one file) is the safest addition, and T17.2 is the swap to consider — it trades DeepSeek's long-horizon weakness for Luna's context weakness across a 3-file change. I favour DeepSeek there because the task is a security invariant and its trap is already written down.
- **Muse Spark is a single point of contention on the critical path.** All four of its branches are in sequential checkpoints, so nothing is lost to parallelism, but if Muse is slow or unavailable the whole spine stalls. **Lever:** T19.1 is the cheapest of the four to move, because `lib/db/native.ts:1206-1294` is an explicit written specification rather than something to be discovered — Gemini can execute it under rule 4.

---

# Part 4 — Branch map

## 4.1 All branches

| Branch | CP | Task | Agent | Rule | Risk |
|---|---|---|---|---:|---|
| `fix/trusted-proxy-fail-fast` | CP17 | SEC-01 — undeployable misconfiguration | Gemini 3.8 Flash | 3 | Low |
| `fix/password-change-revocation` | CP17 | SEC-02 — session invalidation + cookie re-issue | DeepSeek V4 Flash | 1 | **High** |
| `fix/mobile-bearer-gate` | CP17 | SEC-03 — make the kill switch real | Gemini 3.8 Flash | 4 | Med |
| `perf/scoped-import-totals` | CP18 | PERF-01 — call site swap + retire the RPC | Muse Spark 1.3 | 2 | Med |
| `fix/reports-server-date-range` | CP18 | FE-01 — push the date filter to the server | GPT-5.6 Luna | 5 | Low |
| `feat/branding-logo-proxy` | CP18 | SEC-04 — same-origin logo proxy + SSRF guards | DeepSeek V4 Flash | 1 | Med |
| `perf/branding-request-cache` | CP18 | P3 — React `cache()` on `getBranding` | Gemini 3.8 Flash | 4 | Low |
| `fix/supabase-restore-atomicity` | CP19 | REL-01 — transactional restore, honest counts | Muse Spark 1.3 | 2 | **High** |
| `feat/mobile-kv-seam` | CP20 | MOB-01a — TS-side durable KV abstraction | Muse Spark 1.3 | 2 | Med |
| `feat/mobile-kv-native` | CP21 | MOB-01b — Kotlin/Swift/C++ generic KV methods | Gemini 3.8 Flash | 3 | **High** |
| `perf/admin-create-returning` | CP21 | Remove the create→list→find roundtrip | DeepSeek V4 Flash | 1 | Med |
| `refactor/timesheet-domain-service` | CP22 | Spine B — one domain layer for web + mobile | Muse Spark 1.3 | 2 | **High** |

Rule numbers refer to 3.3. Every assignment traces to a benchmark margin; none is by subject-matter stereotype.

## 4.2 Conflict matrix and merge order

Branches within a checkpoint touch disjoint files and may be developed and merged in any order. Cross-checkpoint conflicts:

| Contended file | Branches | Resolution |
|---|---|---|
| `lib/db/supabase.ts`, `supabase/migrations/` | `perf/scoped-import-totals`, `fix/supabase-restore-atomicity` | CP18 merges first; CP19 rebases. `perf/scoped-import-totals` *removes* an RPC, so doing it first shrinks CP19's surface. |
| `lib/db/repository.ts` | `perf/scoped-import-totals` (removes a member), `perf/admin-create-returning` (changes a signature) | CP18 before CP21. |
| `mobile/src/storage/*` | `feat/mobile-kv-seam`, `feat/mobile-kv-native` | Seam first (CP20) against an injectable mock module; native implementations second (CP21). The seam's tests must pass before any platform code is written. |
| `app/actions/timesheets.ts`, `lib/api/v1/services/timesheets.ts` | `refactor/timesheet-domain-service` vs everything in CP17–CP19 | Last (CP22), always. Refactoring a layer while its callers are being patched guarantees a merge conflict and hides which change caused a regression. |
| `app/components/ui.tsx` | `feat/branding-logo-proxy`, `perf/branding-request-cache` | Only the proxy branch edits `BrandMark`; the cache branch edits `app/layout.tsx` only. Enforce that boundary in review. |

**Serial spine:** CP17 → CP18 → CP19 → CP20 → CP21 → CP22.
**Maximum useful parallelism:** 4 agents during CP18 — one branch each, one agent each, no contention. CP17 is 3-wide but only 2 agents (Gemini holds T17.1 and T17.3), so CP17 partially serialises; CP21 is 2-wide with 2 agents. CP19, CP20, and CP22 are single-branch by construction.
**Critical path:** Muse Spark carries one branch in each of CP18, CP19, CP20, and CP22 — sequential checkpoints, so no parallelism is sacrificed, but see 3.4 for the contention lever if that agent is slow or unavailable.

---

# Part 5 — Checkpoints

## CP17 — Security correctness (release blocker)

**Gate:** standard gate green in both backend modes + the three regression tests below exist and fail on the parent commit.
**Nothing in CP18–CP22 may merge before this gate passes.**

### T17.1 — Make the unsafe proxy configuration undeployable
**Agent:** Gemini 3.8 Flash (rule 3 — deploy/config/toolchain, Terminal-Bench ~89–91%) · **Branch:** `fix/trusted-proxy-fail-fast` · **Risk:** Low
**Files:** `lib/ip.ts`, `docker-compose.yml`, `.env.example`, `deploy/README.md`, `tests/ip.test.ts`

**Problem:** see 2.3. In production with no Vercel headers and `TRUSTED_PROXY_HOPS` unset, `lib/ip.ts:103` returns `'direct-client'` for every request, collapsing four IP-keyed rate-limit buckets into one org-wide 10/hour budget.

**Required change:**
1. Add a boot-time check that runs once in production when `NEXT_PUBLIC_BACKEND=native`: if neither `VERCEL` nor a positive integer `TRUSTED_PROXY_HOPS` is present, throw with a message naming the variable and the two safe values (`1` behind a single reverse proxy, `0` for direct exposure). Provide an explicit escape hatch — `ALLOW_UNTRUSTED_CLIENT_IP=true` — which downgrades it to a single `console.warn`. Put the check where it cannot be tree-shaken out of the server bundle; do not put it in a client-reachable module.
2. Set `TRUSTED_PROXY_HOPS=1` in `docker-compose.yml` and uncomment it in `.env.example:54` with a comment stating that `0` means "no proxy — do not use behind nginx/ALB".
3. **Do not** change the resolution order in `lib/ip.ts`. Leftmost `x-forwarded-for` stays untrusted; `'direct-client'` remains the correct fail-closed value once the config is guaranteed.
4. Document in `deploy/README.md` that `TRUSTED_PROXY_HOPS` counts hops **from the right** of `x-forwarded-for`.

**Acceptance:** a production+native process with no `TRUSTED_PROXY_HOPS`, no `VERCEL`, and no opt-out refuses to boot; with the opt-out it boots and warns; `deploy/configmap.yaml` (already `"1"`) and the updated compose file both boot clean. Existing `lib/ip.ts` behaviour is byte-for-byte unchanged.

**Verify:** `npx vitest run tests/ip.test.ts` · `npm run typecheck`

### T17.2 — Password change must invalidate every other session
**Agent:** DeepSeek V4 Flash 0731 (rule 1 — highest-consequence security invariant in the plan; CyberGym 76.7%, and the file set is three named files, which contains its 54.4% DeepSWE) · **Branch:** `fix/password-change-revocation` · **Risk:** High
**Files:** `lib/auth/native.ts`, `app/api/auth/change-password/route.ts`, `app/api/v1/auth/change-password/route.ts`, `tests/auth-native.test.ts` (+ route tests)

**Problem:** `changePassword()` in `lib/auth/native.ts` writes `password_hash` and nothing else. Web cookies keyed on the old `session_version` stay valid and every `mobile_sessions` row stays live, so a stolen session survives the exact action taken to end it. Two call sites share the defect.

**Required change:**
1. Rewrite `changePassword` to run in a single transaction, copying the shape already proven in `lib/db/password-recovery.ts:93-116`: verify the current password, then `update public.profiles set password_hash = $1, session_version = session_version + 1 where id = $2 returning session_version`, then revoke live mobile sessions (`mobileSessionStore.revokeAll(userId)`, or the equivalent `update public.mobile_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and revoked_at is null` inside the same transaction — prefer the latter so a revocation failure rolls the password back).
2. Return the new `sessionVersion` alongside `{ error }`. Keep the existing `verifyDummyPassword` timing-equalisation path on the user-not-found branch.
3. **Both** routes must re-issue the caller's cookie from the returned version via `signSessionToken` + `setSessionCookie` before responding. See 2.3 — omitting this 401s the user immediately after a successful change.
4. Preserve the web route's `originCheck`, `passwordSchema`, and its release of the rate-limit slot on success.

**Acceptance:** after a successful change, (a) a second web cookie minted pre-change is rejected by `getSessionUser()`, (b) every `mobile_sessions` row for the user has `revoked_at` set, (c) the caller's own subsequent request still authenticates, (d) a forced revocation failure leaves `password_hash` unchanged. Behaviour identical on both routes.

**Verify:** `npx vitest run tests/auth-native.test.ts` · then the full suite — this function is widely mocked.

### T17.3 — Make the mobile API kill switch actually gate
**Agent:** Gemini 3.8 Flash (rule 4 — one extracted predicate applied across six named routes; specified, not discovered) · **Branch:** `fix/mobile-bearer-gate` · **Risk:** Medium
**Files:** `app/api/v1/_http.ts`, `app/api/v1/config/route.ts`, `app/api/v1/auth/login/route.ts`, `app/api/v1/auth/refresh/route.ts`, `app/api/v1/auth/signup/route.ts`, new `tests/api-v1-gate.test.ts`

**Problem:** `MOBILE_BEARER_AUTH_ENABLED` is read only by `/api/v1/config`. `requireMobileActor` in `app/api/v1/_http.ts` never consults it, so the entire authenticated mobile surface is live whenever `MOBILE_AUTH_SECRET` is set.

**Required change:**
1. Extract one predicate — `isMobileApiEnabled()` — and have `/api/v1/config` consume it instead of inlining the check, so the advertised state and the enforced state cannot drift.
2. Enforce it in `requireMobileActor` and in the unauthenticated token-issuing routes (`login`, `refresh`, `signup`). Return a disabled response using the existing `lib/api/v1/contracts.ts` error shape — pick one code and use it everywhere; do not invent a per-route shape.
3. `/api/v1/config` must stay reachable while disabled (it is how a client discovers the state) and must keep reporting `false`.
4. Decide and document the default for an unset variable. **Recommended: unset = enabled**, matching today's deployed behaviour — flipping the default silently breaks every shipped mobile build. Record that choice in `deploy/README.md`.

**Acceptance:** with the flag unset → current behaviour, unchanged. With `MOBILE_BEARER_AUTH_ENABLED=false` → every authenticated `/api/v1/*` route and all three token-issuing routes return the disabled error, `/api/v1/config` returns `enabled: false`, and no route leaks whether a credential was valid.

**Verify:** `npx vitest run tests/api-v1-gate.test.ts` · `npx vitest run tests/api-v1-*.test.ts`

---

## CP18 — Call-site corrections (four parallel branches)

Three of these are Part 2.2 tasks: the correct primitive exists and is named, so the diffs are small and mechanically checkable.

### T18.1 — Scope the import's daily-total lookup and retire the RPC
**Agent:** Muse Spark 1.3 (rule 2 — deleting an interface member safely requires exhaustive call-site discovery across ~9 files including test mocks and docs; SWE-Atlas 59.4%, long-context 98.5%) · **Branch:** `perf/scoped-import-totals` · **Risk:** Medium
**Files:** `app/actions/import-backup.ts`, `lib/db/repository.ts`, `lib/db/native.ts`, `lib/db/supabase.ts`, new `supabase/migrations/<ts>_drop_daily_totals_rpc.sql`, `tests/supabase-migrations.test.ts`, `tests/native-repository.test.ts`, affected action tests, `AGENTS.md`

**Problem:** `app/actions/import-backup.ts:122` calls `repo.getTimesheetDailyTotals(actor)`, which in native mode is an unfiltered `select user_id, log_date, sum(hours_worked) from public.timesheets group by user_id, log_date` (`lib/db/native.ts:1453-1461`) — a full scan of the table on **every** CSV import, to look up a handful of days. In Supabase mode it is worse than slow: `lib/db/supabase.ts:1439-1447` reaches for `getAdminClient().rpc('get_timesheet_daily_totals')` because `supabase/migrations/20260902000000_restrict_totals_rpc.sql` revoked the RPC from `authenticated`. That is a **service-role read of every user's hours**, which is precisely what `AGENTS.md` forbids: *"do not route a read-only aggregate through the service-role client when it exposes other users' rows."*

**Required change:**
1. Replace the call with `repo.sumHoursForUserDates(actor, pairs)`, building `pairs` from the `{userId, logDate}` values already present in the `out: TimesheetInput[]` array in scope. Keep the `Map` keyed `` `${userId}|${logDate}` `` so the 24h-cap arithmetic below is untouched.
2. Delete `getTimesheetDailyTotals` from `lib/db/repository.ts` and both adapters. Verify with a repo-wide search that no other call site exists before deleting.
3. Add a **new** Supabase migration dropping the `get_timesheet_daily_totals` function — do not edit `20260902000000_restrict_totals_rpc.sql`. Update the grant assertions in `tests/supabase-migrations.test.ts` and remove the RPC's mention from `AGENTS.md`.
4. Confirm no new service-role client usage appears; net service-role call sites must go **down** by one.

**Acceptance:** import behaviour and the 24h daily-cap rejection are unchanged (regression test: an import that would exceed 24h on a day with pre-existing entries is still rejected, with the same message). Both backends build. Non-admin actors remain scoped by `sumHoursForUserDates`'s own `where t.user_id = $3` branch — which is strictly *tighter* than the deleted method's `isAdminActor` early-return-`[]`, so re-check the import path's actor expectations rather than assuming parity.

**Verify:** `npx vitest run tests/supabase-migrations.test.ts tests/native-repository.test.ts` · `npm test` · build in both modes

### T18.2 — Push the reports date filter to the server
**Agent:** GPT-5.6 Luna (rule 5 — one file, one concern, fix already identified; SWE-Bench Pro 62.7%, and the small file set makes its 41.3% long-context irrelevant) · **Branch:** `fix/reports-server-date-range` · **Risk:** Low
**Files:** `app/reports/page.tsx`, new/extended `tests/reports-page.test.tsx`

**Problem:** `app/reports/page.tsx` fetches `getTimesheets({ from: 0, to: PAGE_SIZE - 1 })` with **no date params** (`:141-154` and the `useEffect` at `:170-198`), then filters client-side through `selectRows(timesheets, range.start, range.end, projectFilter, user)` at `:213-216`. With `PAGE_SIZE = 1000`, any org past 1000 total rows shows a silently truncated table. Note the asymmetry that makes this a data-trust bug rather than a perf bug: **CSV export is already correct** — it goes through `/api/data/reports/export?from=..&to=..` and `dataClient.getReportTotals(...)` server-side. So the on-screen table and the exported file can disagree, and the file is the one that's right.

**Required change:**
1. Pass `dateFrom: range.start` and `dateTo: range.end` into `getTimesheets`. Both adapters already support these fields — `lib/data/client.ts:111-112` (`.gte`/`.lte`) and `:320-321` (`params.set`). No client, API, or repository change is needed.
2. Refetch when `range` changes; keep `projectFilter` client-side (it is a small enum). Guard against overlapping in-flight requests so a fast range change cannot land stale rows.
3. Keep pagination. If a filtered range still returns a full page, either page through it or surface an explicit "showing first N of range" notice — **silent truncation is the bug; do not preserve it in a narrower form.**
4. Add a loading state on range change and keep the table's existing a11y semantics intact.

**Acceptance:** a seeded dataset >1000 rows shows a table whose totals match the CSV export for the same range. Network panel shows one request per range change carrying `dateFrom`/`dateTo`. Project filtering still works without a refetch.

**Verify:** `npx vitest run tests/reports-page.test.tsx` · `npm run a11y`

### T18.3 — Serve the branding logo same-origin
**Agent:** DeepSeek V4 Flash 0731 (rule 1 — the substance is SSRF control design, which is exactly CyberGym 76.7% territory; four named files) · **Branch:** `feat/branding-logo-proxy` · **Risk:** Medium
**Files:** new `app/api/branding/logo/route.ts`, `app/components/ui.tsx`, `lib/branding.ts` (if a helper is needed), new `tests/branding-logo-proxy.test.ts`

**Problem:** see 2.3 — CSP `img-src 'self' data: blob:` blocks the validated HTTPS `logoUrl`, `BrandMark`'s `onError` swaps in the bundled logo, and the feature fails silently. `next.config.ts` has no `images.remotePatterns`, so `next/image` is not an escape.

**Required change:**
1. Add a route that resolves the current branding `logoUrl`, fetches it server-side, and streams the bytes with a strict `Content-Type` allowlist (`image/png|jpeg|webp|svg+xml|gif` — if SVG is allowed, serve it with `Content-Disposition: inline` and `Content-Security-Policy: default-src 'none'` on the response to neutralise embedded script) and a sane `Cache-Control`.
2. **SSRF controls are the substance of this task,** because `logoUrl` is admin-supplied and the fetch runs from inside the network: resolve and reject loopback/private/link-local/unique-local destinations, cap redirects (prefer `redirect: 'manual'` and re-validate each hop), set a request timeout, cap the response body size, and re-run `lib/branding.ts`'s HTTPS validation server-side rather than trusting stored data.
3. Point `BrandMark` at the same-origin route; keep the `onError` fallback to `/brand/vsis-logo-compact.jpg`. When no `logoUrl` is configured the route should redirect or 404 fast so the fallback still paints.
4. **Leave `next.config.ts` CSP unchanged.** That is the point of the exercise; a PR that adds `https:` to `img-src` fails review.

**Acceptance:** a configured HTTPS logo renders with the production CSP unmodified; `http://`, credentialed, private-range, oversized, non-image, and redirect-to-private URLs are all rejected without leaking internal response detail; no `logoUrl` configured → bundled logo, no console errors.

**Verify:** `npx vitest run tests/branding-logo-proxy.test.ts` · `npm run build && npm run start`, then confirm zero CSP violations in the browser console

### T18.4 — Deduplicate the per-request branding query
**Agent:** Gemini 3.8 Flash (rule 4 — three named call sites, mechanical, keeps CP18 four-wide) · **Branch:** `perf/branding-request-cache` · **Risk:** Low
**Files:** `app/layout.tsx` (+ a small shared module for the cached getter)

**Problem:** `app/layout.tsx` calls `await repo.getBranding()` three times per render — `generateMetadata` (`:24`), `generateViewport` (`:40`), `RootLayout` (`:58`) — each in its own try/catch, with no memoisation. Three identical queries on every SSR page load.

**Required change:** wrap the getter in React `cache()` in one shared module and have all three call sites use it. Preserve each site's independent fallback-to-`DEFAULT_BRANDING` behaviour on error — `cache()` memoises rejections too, so make sure one failure yields the default in all three places rather than an unhandled throw. Do not restructure the layout. `derivePalette` and the `--primary-50..900` variables stay as they are.

**Acceptance:** one branding query per SSR request (assert via a repo spy). Rendered output byte-identical for both a configured and an unconfigured branding row.

**Verify:** `npx vitest run tests/layout*.test.tsx` (add one if absent) · `npm run build`

---

## CP19 — Restore atomicity

**Depends on:** CP18 merged (`perf/scoped-import-totals` touches the same file and removes an RPC).

### T19.1 — Transactional Supabase restore with honest reporting
**Agent:** Muse Spark 1.3 (rule 2 — requires holding the native implementation and the Supabase one in context simultaneously and replicating exact conflict/skip/count semantics across languages) · **Branch:** `fix/supabase-restore-atomicity`
**Security review:** DeepSeek V4 Flash 0731 must sign off on the `SECURITY INVOKER`/`DEFINER` decision and the grant surface before merge. Review by a second agent is not a task split (3.3). · **Risk:** High
**Files:** `lib/db/supabase.ts`, new `supabase/migrations/<ts>_restore_backup_txn.sql`, `tests/supabase-restore.test.ts`

**Problem — read Part 1 correction #2 before starting.** The report's "unbatched sequential inserts" claim is wrong: `lib/db/supabase.ts:1187-1339` already batches at `BATCH_SIZE = 50` and already scopes its pre-reads with `.in('user_id', …).in('log_date', …)` plus `.range()` paging. The real defects are:
1. **No transaction.** PostgREST gives one HTTP request per batch, so a restore is N independent commits. There is no rollback.
2. **The error return lies.** On a mid-stream failure the function returns `{ ...empty, error: error.message }` — `created` counts of **zero** — even though earlier batches committed. The operator reads "failed, nothing created" and may re-run, double-inserting; the audit log records nothing.

The native adapter already does this correctly (`lib/db/native.ts:1206-1294`: `getPool().connect()` + `begin`, existing-entry lookup scoped by `where user_id = any($1::uuid[]) and log_date = any($2::date[])`). **Native is the specification.**

**Required change:**
1. Move the merge server-side into one Postgres function taking a `jsonb` payload, so the whole restore is a single transaction. Mirror the native adapter's semantics exactly — same conflict/skip rules, same counted categories, same 24h-cap interaction.
2. **Security, per `AGENTS.md`:** default to `SECURITY INVOKER` so RLS applies. If `SECURITY DEFINER` is genuinely required, it must come with an explicit owner, a pinned `search_path`, grants narrowed to the intended role only, in-function actor authorization, and grant assertions added to `tests/supabase-migrations.test.ts`. A bare `SECURITY DEFINER` fails review.
3. **If a single transaction is rejected as too large a change,** the fallback is *not* to keep the current behaviour: make the partial-commit path honest. Return the true `created` counts alongside the error, mark the result partial, and write the audit entry for what did commit. Silent under-reporting is the defect; slowness is not.
4. Keep the existing scoped pre-reads and `.range()` paging.

**Acceptance:** a restore that fails partway leaves the database exactly as it was (transactional path) **or** reports counts that match the rows actually present (fallback path) — never zeros-with-rows-present. Success-path counts, conflict handling, and audit entries are identical between native and Supabase for the same input file. A re-run after a failure is idempotent.

**Verify:** `npx vitest run tests/supabase-restore.test.ts tests/supabase-migrations.test.ts` · run the same backup file through **both** backends and diff the resulting `created` objects · `TEST_DATABASE_URL` integration tests

---

## CP20 — Mobile persistence seam (JS side)

### T20.1 — One durable KV abstraction, no fourth copy of the fallback chain
**Agent:** Muse Spark 1.3 (rule 2 — designing the seam requires understanding all four existing stores at once to avoid producing a fifth variant of the fallback chain; SWE-Atlas 59.4%, AutomationBench 49.4%) · **Branch:** `feat/mobile-kv-seam` · **Risk:** Medium
**Files:** new `mobile/src/platform/kv-store/{index.ts,types.ts,native.ts,memory.ts}`, `mobile/src/storage/offline-queue.ts`, `mobile/src/storage/theme-store.ts`, new `mobile/src/platform/kv-store/__tests__/*`

**Problem — Part 1 correction #3 applies; a third of MOB-01 is already fixed.** `mobile/src/storage/offline-queue.ts` keeps queued mutations in `private inMemory = new Map<string, QueuedOfflineMutation[]>()` and persists only through `getGlobalScope().localStorage` inside `try {} catch {}`. **React Native has no `localStorage`**, so on Android and iOS every write silently no-ops and unsynced mutations are lost on process death — the exact failure the offline queue exists to prevent. `theme-store.ts` has the same shape (localStorage, then Node `fs` via `scope.require('fs')`) and is cosmetic. `mobile/package.json` confirms there is no `AsyncStorage` or MMKV dependency to fall back on.

The design constraint is *how* it gets fixed. `workspace-store.ts` was fixed by adding a native tier to its own private copy of the chain, which is why the other two stores are still broken. **Do not add a fourth copy.** The model to imitate is `mobile/src/platform/secure-storage/native.ts`: one module, constructor-injectable, typed errors, and an explicit policy — *"Native platform modules own persistence; JavaScript never falls back to files, browser storage, or memory."*

**Required change:**
1. Define a `KvStore` interface (`getItem`/`setItem`/`removeItem`, async) plus a typed error mirroring `SecureStorageError`'s code set (`unavailable|corrupt|read-failed|write-failed|delete-failed`). Accept an injected native module so the whole thing is unit-testable without a device.
2. Implement the native-backed adapter against the generic `readItem`/`writeItem`/`removeItem` methods that T21.1 will add to the three platform modules. **Ship the TS side first against a mock** — CP20's tests must pass before any platform code exists.
3. Rewrite `offline-queue.ts` on top of it. Durability is the requirement: a write must be acknowledged by native storage before the queue reports the mutation as persisted, and a read failure must surface, not silently yield an empty queue. Keep the existing replay ordering and `QueuedOfflineMutation` shape.
4. Rewrite `theme-store.ts` on the same seam. It may degrade to the default theme on failure — say so in a comment, since its policy differs from the queue's.
5. Provide an explicit in-memory adapter for tests and Node/CLI contexts, selected by injection — not by a `try { require('fs') }` probe. Delete the `localStorage` and `getNodeFs()` paths from both rewritten stores.
6. **Migration:** if a device already has a `localStorage`-persisted queue it was never actually written on RN, so no data migration is needed for `offline-queue`. State that conclusion in the PR rather than leaving it implicit.
7. Optionally refactor `workspace-store.ts` onto the seam too — but only if it can be done with **no behaviour change** to `DISCONNECTED_SENTINEL`, `validateWorkspaceUrl`, or `getBuildTimeDefaultWorkspaceUrl`. If that is not clean, leave it and note the follow-up.

**Acceptance:** neither `offline-queue.ts` nor `theme-store.ts` references `localStorage`, `globalThis.require`, or `fs`. A simulated process restart (fresh module instance, same mock backing store) recovers all queued mutations. An unavailable native module makes queue writes fail loudly rather than silently succeed.

**Verify:** `cd mobile && npm test` · `cd mobile && npx tsc --noEmit`

---

## CP21 — Native modules and write-path roundtrips (two parallel branches)

### T21.1 — Generic KV methods on all three platforms
**Agent:** Gemini 3.8 Flash (rule 3 — three native toolchains, Gradle/Xcode/MSBuild; Terminal-Bench ~89–91% is the closest proxy for platform-SDK work. Its weaker SWE-Atlas 51.9% is contained because the existing `readWorkspace`/`writeWorkspace`/`clearWorkspace` trio is a working template in each of the three files and T20.1's TS contract is the spec) · **Branch:** `feat/mobile-kv-native` · **Risk:** High
**Files:** `mobile/android/app/src/main/java/com/vsis/timesheet/VsisSecureStorageModule.kt`, `mobile/ios/mobile/VsisSecureStorage.swift`, `mobile/ios/mobile/VsisSecureStorageBridge.m`, `mobile/windows/VsisTimesheetMobile/VsisSecureStorage.h`, `mobile/src/platform/secure-storage/native.ts` (type declarations)

**Depends on:** T20.1 merged — the TS contract is the spec.

**Problem:** the seam from CP20 needs a generic key/value surface. Today the module exposes only the fixed-purpose `read`/`write`/`clear`/`clearLegacy` and the workspace trio `readWorkspace`/`writeWorkspace`/`clearWorkspace` added by `7006dcc`.

**Required change:**
1. Add `readItem(key)`, `writeItem(key, value)`, `removeItem(key)` to all three platform modules, following each platform's existing storage choice: Android Keystore-backed store in the Kotlin module, iOS Keychain (`VsisSecureStorage.swift` — note the existing `accountWorkspace = "WorkspaceUrl"` account-naming convention, and remember every method needs a matching `RCT_EXTERN_METHOD` in `VsisSecureStorageBridge.m`), Windows `PasswordVault` (`VsisSecureStorage.h` — follow the existing `c_account_workspace` constant pattern and `REACT_METHOD` registration).
2. **Namespace keys** so app data cannot collide with the credential entries; validate/reject empty or oversized keys at the native boundary.
3. **Honour the documented Windows absence contract** recorded in `mobile/src/platform/secure-storage/native.ts:124-131`: Windows cannot resolve `null` on `ReactPromise<std::string>` and returns `""` for a missing entry, while iOS and Android resolve `null`. The TS adapter must treat empty as absent. Do not "fix" this by changing the native signature.
4. Reject non-string values at the boundary; the queue serialises to JSON in TS.
5. Note in the PR that the offline queue may hold more data than a credential vault comfortably stores; if a platform's secure store has a practical size limit, say so and propose the follow-up rather than silently truncating.

**Acceptance:** each platform builds; a write→read→remove→read cycle round-trips correctly on each platform, with the final read reported as absent through both the `null` and `""` conventions. Existing credential and workspace methods are untouched and their tests still pass.

**Verify:** `cd mobile && npm test` · Android and Windows release builds · **manual device/emulator check per platform — CI cannot cover this. State in the PR which platforms were actually exercised and which were not.**

### T21.2 — Return the created row instead of re-listing to find it
**Agent:** DeepSeek V4 Flash 0731 (rule 1 — the racy name-match lookup is a concurrency-correctness defect, and the fix is `insert … returning` SQL; Toolathlon 70.3% for the multi-step verification) · **Branch:** `perf/admin-create-returning` · **Risk:** Medium
**Files:** `lib/db/repository.ts`, `lib/db/native.ts`, `lib/db/supabase.ts`, `app/api/v1/admin/projects/route.ts` (+ sibling admin create routes), affected tests

**Depends on:** CP18 merged (`perf/scoped-import-totals` also edits `lib/db/repository.ts`).

**Problem:** `app/api/v1/admin/projects/route.ts` POST does `createProject` → `listProjects` → `allProjects.find(p => p.name === name)` → optional `setProjectSO` → optional `setProjectTelegramNo` → `listProjects` **again** → `refreshed.find(...)`. That is up to five round-trips to create one row, and the name-based lookup is **racy**: two concurrent creates with the same name can return each other's row. Sibling admin create routes share the pattern — grep before scoping.

**Required change:**
1. Extend the `Repository` write contract so creates return the new row's identity. `DbWrite` is `{ error: string | null }` by convention, so introduce a distinct return type for these creates rather than overloading `DbWrite` — keep the existing convention intact for everything else, and preserve every current action name and signature (`AGENTS.md`).
2. Native: `insert … returning`. Supabase: `.insert(...).select().single()`. Both must keep their existing authorization gates — native gates in SQL params, Supabase leans on RLS plus actor checks; **do not** reach for the service-role client to make this easier.
3. Fold the optional `setProjectSO` / `setProjectTelegramNo` follow-ups into the insert where the columns allow it, so one create is one statement.
4. Delete the name-match lookups.
5. Apply the same treatment to sibling admin creates only where the identical pattern exists; do not opportunistically refactor beyond that.

**Acceptance:** creating a project issues one write and returns the same DTO shape as before (contract-compatible with shipped mobile clients — check `lib/api/v1/contracts.ts`). Two concurrent creates with the same name each receive their own row's id. Both backends behave identically.

**Verify:** `npx vitest run tests/api-v1-admin-projects.test.ts tests/native-repository.test.ts` · `npm test` · build in both modes

---

## CP22 — Structural: close the client-duality seam

**Depends on:** CP17–CP19 all merged. This is deliberately last — see 4.2. Refactoring this layer while its callers are being patched guarantees conflicts and hides which change caused a regression.

### T22.1 — One timesheet domain service for web and mobile
**Agent:** Muse Spark 1.3 (rule 2, unambiguously — reconciling two independent implementations rule-by-rule with zero behaviour change is the single most comprehension-bound task here. Long-context 98.5 / 98.1 vs Luna's 41.3 is the deciding margin; routing this to a 41.3% retriever would be the worst assignment available) · **Branch:** `refactor/timesheet-domain-service` · **Risk:** High
**Files:** new `lib/domain/timesheets.ts`, `app/actions/timesheets.ts`, `lib/api/v1/services/timesheets.ts`, tests for both surfaces

**Problem:** Spine B (2.1). `app/actions/timesheets.ts` and `lib/api/v1/services/timesheets.ts` independently implement the same validation and authorization rules for the same table. SEC-02 is the concrete cost: one defect, two exploit surfaces, two fixes, two test suites. Every future rule pays it again.

**Required change:**
1. Extract the shared rules — validation, authorization decisions, the 24h daily-cap interaction, and error taxonomy — into one transport-agnostic module that takes an `Actor` and returns typed results. No `next/headers`, no cookies, no `Request`, no HTTP status codes inside it.
2. Leave the transport concerns where they belong: Server Actions keep `requireActiveActor` / `requireActor(roles)` from `app/actions/_shared.ts`, keep returning `{ error }` shapes, and keep never throwing to the client; `/api/v1` keeps `requireMobileActor`, Bearer handling, and the `lib/api/v1/contracts.ts` DTO mapping. **Both wrappers must stay thin — the moment a rule lives in a wrapper, the seam has failed again.**
3. **Zero behaviour change is the acceptance bar.** Server Action names and signatures are preserved (`AGENTS.md`); the v1 DTO contract is preserved byte-for-byte for shipped mobile clients. Two different error strings for the same condition is a finding, not a detail — reconcile deliberately and record each reconciliation in the PR.
4. Do the extraction in reviewable steps: land the module with tests first, migrate one surface, confirm green, then migrate the other. Do not migrate both in one commit.
5. Timesheets only. Projects, users, and settings are follow-up work; note them, do not start them.

**Acceptance:** no business rule exists in two places for timesheets. Both existing test suites pass **unmodified except for import paths** — if a test's expectations had to change, the refactor changed behaviour and the diff needs justification. Coverage does not drop below the CI gate.

**Verify:** `npm test` · `npm run test:coverage` · `npm run e2e` · build in both modes

---

# Part 6 — The standard gate

Every PR runs this before review. CI builds in **both** backend modes, so a change that compiles only under one is not done.

```bash
npm run lint && npm run typecheck && npm test && npm run test:coverage
```

```bash
NEXT_PUBLIC_BACKEND=supabase npm run build && NEXT_PUBLIC_BACKEND=native npm run build
```

Additional gates by area:

| Area | Extra requirement |
|---|---|
| `lib/db/*`, migrations | `TEST_DATABASE_URL` integration tests actually run (they **skip silently** when unset — state in the PR that they ran). New migration file only; never edit an applied one. |
| Supabase RPC/grants | `npx vitest run tests/supabase-migrations.test.ts`. `SECURITY INVOKER` by default; any `SECURITY DEFINER` needs owner + pinned `search_path` + narrow grants + tests. |
| Auth / session | Prove the negative case: an old credential is rejected *and* the current caller still works. |
| `app/` client | `npm run a11y`. Playwright boots the **production** server, so `npm run build` first and supply seeded `E2E_EMAIL`/`E2E_PASSWORD`. |
| `mobile/` | `cd mobile && npm test && npx tsc --noEmit`. Native changes need a manual device pass; name the platforms exercised. |

## Rules for every agent on this plan

- **`git status` before starting and before finishing.** Final diff = intended changes only; remove scratch and probe files.
- `next dev` rewrites the top block of `AGENTS.md`. If it reappears in your diff, commit it with your work — reverting only re-creates the change.
- Do not rename or translate identifiers, file paths, commands, or commit scopes.
- Conventional Commits: `<type>(<scope>): <desc>`.
- Tests: happy path + ≥1 failure mode; new repo/auth behaviour gets a regression test. Use `vi.hoisted` for `vi.mock` factories that reference top-level values.
- Never open a `pg` client outside `lib/db/*`.
- Verify Next.js 16 APIs in `node_modules/next/dist/docs/` — do not assume training data.
- **Do not merge to `main` directly and do not commit unless asked.** One branch, one PR, one reviewer.

---

# Part 7 — Explicitly out of scope

| Item | Why |
|---|---|
| Composite index on `timesheets (user_id, log_date)` | **Already exists** in both backends. Report claim was false — Part 1 #1. |
| Batching the Supabase restore inserts | **Already batched** at `BATCH_SIZE = 50` with scoped pre-reads. The real work is atomicity and honest counts — Part 1 #2, T19.1. |
| A native persistence path for `workspace-store.ts` | **Already shipped** in commit `7006dcc`, all three platforms implemented. Optional refactor onto the CP20 seam only if behaviour-neutral. |
| Changing `lib/ip.ts` resolution order | Current order is correct and deliberately fail-closed. The bug is configuration, not logic — T17.1. |
| Adding `https:` to CSP `img-src` | Weakens the policy for a cosmetic feature. Use the same-origin proxy — T18.3. |
| Domain-service extraction for projects/users/settings | Sequenced after T22.1 proves the pattern on timesheets. |
| Any metric from the input report (file counts, LOC, endpoint totals) | Unverified — Part 1 #5. |

## Residual risk after CP22

- **T21.1 cannot be verified in CI.** No device farm exists in `.github/workflows/ci.yml`. Mobile native correctness rests on a manual pass; treat the platform list in that PR as the evidence.
- **T19.1's fallback path is a knowing compromise.** If the transactional version is rejected, restores remain non-atomic — the fix is only that operators stop being misinformed.
- **T17.1 changes boot behaviour.** A production deployment that relied on the unset default will now refuse to start. That is the intent, but it must be called out in release notes, and `ALLOW_UNTRUSTED_CLIENT_IP` exists so nobody is stranded.
- **Spine B stays open for three domains** until the projects/users/settings extractions land. Until then, any new auth or validation rule must still be written twice — and reviewers should assume the second copy was forgotten.
- **The benchmark table has gaps, and three assignments rest on a single unreplicated number.** T17.2, T18.3, and T21.2 all go to DeepSeek on the strength of one CyberGym score (76.7%) with no second security benchmark to corroborate it, against a measured 20pp deficit on long-horizon engineering. If DeepSeek underperforms on the first of those — T17.2 is the earliest signal, in CP17 — re-run 3.3 with rule 1 disabled rather than persisting through the other two. Under that variant T18.3 goes to Muse and T21.2 to Gemini.
- **Two agents are assigned work outside any benchmark that directly measures it.** Gemini's T21.1 (Kotlin/Swift/C++ against three platform SDKs) is justified by Terminal-Bench, which measures terminal and tool engineering, not native mobile SDKs; and DeepSeek's codebase-understanding standing is unknown, since NL2Repo and SWE-Atlas are not comparable. Both are reasoned proxies, not evidence.


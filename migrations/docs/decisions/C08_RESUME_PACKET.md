# C08 resumed actual-data rehearsal — 2026-10-04

## Decision and scope

Resume the user-authorized disposable actual-source-data rehearsal after D2.
Use a fresh protected export and fresh seeded native clone; preserve the original
native baseline and previous successful rehearsal. Production source is read
only. No production fence, Auth operation, admission, cutover or retirement.

## Verified evidence

- FACT: Fresh source `inspect` passed at 13:53 UTC. Supabase migration ledger
  includes `20261006000000`; fingerprint remains
  `486a9ab877a2c48e5de8b15e9f26a981f58ddc188c25b9c129c31f721763e94b`.
  Counts remain 23 profiles, 854 timesheets, 43 projects and 8 activities.
- FACT: D2 adds only an index. `providers/session.ts` catalog inspection and
  `schema.ts` fingerprint admission use tables/columns; required ledger entries
  are minimum milestones. Extra D2 is accepted without changing schema policy.
- FACT: Before qualification, CLI release support was 1.0.3. Existing evidence proved
  import/reconciliation/replay/restore and disposable admission/application smoke,
  but used a compatibility runtime, not a pristine final release artifact.
- FACT: User selected 15 minutes abort/recovery within the accepted 60-minute
  window, leaving 45 minutes for the normal sequence including review.
- UNKNOWN: Production writer controls,
  final native host/release and external enrollment readiness remain unproven.

## Selected lifecycle and alternatives

Reuse the old successful result unchanged: useful historical evidence, insufficient
for fresh snapshot/timing acceptance. Selected: protected fresh export, fresh
baseline clone, preflight, fence, fresh preview and root review, resolve/apply,
verify-record and disposable intent/admit. Preserve all scope and digest guards.
Do not relax schema admission or reuse stale plans.

## Release qualification decision

User selected native application 1.1.6. Production source remains application
1.0.3. Add an explicit directional compatibility rule for Supabase 1.0.3 to
native 1.1.6 while retaining historical 1.0.3 transitions and defaults. Admit
this pair consistently in preflight, plan and apply; reject unknown releases,
reverse transitions and other newly implied provider combinations before writes.
Keep source and legacy tool application-version declarations truthful and equal;
the tool package version remains separate. Preserve artifact formats, digests,
receipts, exact target declaration and all schema/ledger/fence/baseline guards.

Qualification checks cover allowed and refused pairs, truthful export metadata,
target declaration mismatch, schema/ledger refusal and historical replay. Confirm
native migration 0038 separately on the 1.1.6 rehearsal target. Record reviewed
plan and resolution digests before apply. After replay, require empty row drift.
An unchanged no-op outcome alone does not establish reconciliation.

### Qualification finding ledger

| ID | Scenario | Fix and verification | State |
| --- | --- | --- | --- |
| R1 | Truthful 1.0.3 export rejected for selected 1.1.6 target | Shared directional rule; CLI/schema tests preserve refused pairs and schema/ledger guards | Closed by independent delta review |
| R2 | Direct apply bypasses transition admission | Shared rule before identity/provisioning and runtime provider check; refusal/success/replay tests | Closed by independent delta review |
| R3 | Destination release corrupts source provenance | Source/tool declarations remain 1.0.3; defaults, artifact formats/digests and receipts unchanged | Closed by independent delta review |

Settled operator-package verification: 193 focused passes, 445 full passes,
41 optional integration skips, passing lint/typecheck and coverage gates
(83.94% lines; 72.58% branches). Fresh native 1.1.6 production build passed
without compatibility edits. Actual-data import/runtime qualification passed;
the tested checkout contains existing uncommitted application changes.

### Fresh preview and resolution review

Fresh protected export `06093f82ad15e7d8d16a259e21ae02eb5fb895613c20a27e8208ee54838101a5`
matches all 12 prior canonical entities. All 53 conflicts, mappings, source field
choices, 100 security selections and ten settings selections retain prior
semantics; four destination-only projects remain. Seeded restore matched all
24 public table digests. Only clone migration 0038 changed the schema ledger;
the original seeded database remains unchanged.

Root independently verified the actual resolved artifact with zero issues and
pinned these values before authorizing disposable apply:

- Plan: `1c3f17257f818b6271b9fdfb200c61bd5afb4e2645dd005d2e9e492cfb7f5aa5`.
- Resolution: `bdd9ee30b25ce12f9099b113cf19b2e69cd8fad218014505cf6aea1f23c5fe39`.
- Expected state: `aff9274b4abc44921625980451c54fc66a6da3bbfdf27d1f6661521fdea8344e`.
- Target: loopback `vsis_c08_resume_20261004_141316`, namespace
  `native:71e51abbe184be0f16598b45d83cca72`, runtime fingerprint
  `3ca751118ee8d5a4a93aa855816d398e`, native application 1.1.6.
- Run: `resume-20261004-141316`; timer starts at 14:20:40.857 UTC and remains
  continuous through root review and subsequent operational work.

Apply, reconciliation, zero-drift replay, two independent 24-table restores,
disposable intent/admit and native 1.1.6 enrollment/login/business smoke passed.
Actual recovery took 1.818s. Owned runtime and SMTP sink stopped; original seed
and previous successful clone remain unchanged. Verification preceded smoke;
local credential/audit/retry effects remain on the disposable clone.

Root recomputed the unchanged UTC interval through final closure:
14:20:40.857–14:54:17.233 = 2016.376s (33m 36.376s). Adding the 900s reserve
gives 2916.376s (48m 36.376s), within 3600s. Launcher failures and review time
are included. A PowerShell timezone subtraction error was corrected against
absolute UTC timestamps; the clock was not restarted. See
[redacted qualification evidence](../../evidence/c08-native-116-qualification-2026-10-04.json).

Recovered launcher failures required direct-loopback IP acknowledgement, a local
rate-limit subject secret and correct process signal-exit handling. Recovery
revalidated all 12 pinned entity digests plus complete reconciliation against the
authoritative receipt. Neither import nor publication was repeated. No production
proxy, external email delivery, writer shutdown or immutable release claim follows
from this local result. Representative queued edit refusal passed without mutation;
queued replay remains uncertified.

Activation: verify ACLs before recording actual data and exact local target binding.
Normal completion: reconcile complete merged rows/mappings/dispositions, record
verification, test apply no-op, then disposable intent/admit and inspect receipt.
Recovery: before intent, preserve a merged backup and restore seeded baseline on
a separate disposable clone; compare all table digests. Never reopen a gate by
SQL or delete receipts. After intent, retain disposable evidence and follow
existing publication rules. Do not simulate production source shutdown.
Retries: bind to fresh reviewed plan/run and authoritative receipt. Stale artifacts
or concurrent transitions must fail closed; original baseline remains untouched.

## Ownership and acceptance

Worker first owns the bounded migration compatibility implementation and tests;
after integration review it owns scratch helpers, protected new artifacts and
new disposable targets. Root does not concurrently edit worker-owned files.
Root owns docs, preview decisions and integration. Independent reviewer checks
the bounded operational protocol before new apply/publication (migration and
recovery risk), then closes only concrete findings.

Pass requires protected bundle validation, seeded restore parity, fresh preflight,
reviewed overlap/mapping choices, atomic apply/reconciliation/no-op, backup/abort
restore parity, exact publication transitions and measured sequence plus the
15-minute reserve within 60 minutes. A simulated-source interval does not prove
production stop/deny/drain. Prior smoke evidence retains its original scope;
fresh pristine release readiness cannot be inferred from it.

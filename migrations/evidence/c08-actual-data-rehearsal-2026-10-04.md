# Actual-data native rehearsal — 2026-10-04

The technical rehearsal passed on disposable Docker PostgreSQL. Production
Supabase was read only; no production fence, import or publication ran.
This is evidence for preparation, not cutover approval.

Run: `dryrun-20261004-105004`. Protected source bundle contains 1,011 canonical
rows, including 23 profiles and 854 timesheets. Destination:
`vsis_c08_rehearsal_20261004_105004`. Release admission: 1.0.3.

| Check | Result |
| --- | --- |
| Protected bundle validation | Passed; unchanged bundle digest |
| Native seeded backup restore | Passed; all 24 public table row digests match |
| Preflight and resolution | Eight checks passed; 53 conflicts resolved |
| Source business/security choices | Preserved; four destination-only projects retained |
| Transactional apply | Passed; 958 create and 53 map dispositions, zero exclusions; 1.93 s |
| Reconciliation and recorded verification | Passed; 0.23 s |
| Apply replay | No-op; business rows unchanged; 0.37 s |
| Disposable idle drain | 30 s; two zero-active-transaction observations; all row digests unchanged |
| Application fence | Reads allowed; mutation refused with no timesheet change |
| Merged backup and pre-intent abort | Passed on separate clone; baseline restored across 24 tables; 5.87 s |
| Disposable intent and admission | Passed; receipt writable and gate open |
| Enrollment and fresh login | Passed; reset mail captured only in loopback SMTP sink; token reuse refused |
| Business smoke | Create/replay, immediate cookie edit, report totals, invalid-hours refusal and cleanup passed |
| Queued keyed edit | Refused for review without mutation; queued replay not certified |
| Final audit | 23 profiles, 854 timesheets, 47 projects, three dismissals; zero synthetic timesheets |
| Original seeded database | Unchanged |

Two failed apply attempts exposed reference-slot reuse and PostgreSQL-invalid
compound metadata keys. Both rolled back fully: 23 checked tables matched the
baseline and no import receipt survived. The operator repair keeps one fenced
transaction, applies reviewed mapped mutations, stages only changed nullable
unique slots, and encodes compound keys at metadata persistence boundaries.
Canonical artifacts and ordinary UUID mappings remain unchanged.

Independent review also identified stale compound destination mappings when
parent UUIDs remap. The closure repair derives these mappings after foreign-key
rewriting. This actual bundle preserves the relevant parent UUIDs; dedicated
regressions cover remapped parents separately.

Settled verification: 401 migration tests passed, 26 skipped for absent live
prerequisites; 71 planner and 15 live PostgreSQL checks passed. Lint, typecheck
and coverage gates passed (85.73% lines, 73.20% branches). Independent review
closed R1 with no remaining material finding. Re-resolving the actual plan with
the closure patch produced identical plan, resolution and expected-result
digests and ID mappings.

The app runtime was an existing 1.0.3 compatibility harness, not a pristine final
release artifact. Its process was stopped after smoke. Password enrollment,
audit and retry effects intentionally remain only on the disposable clone;
import reconciliation was recorded before smoke.

Open final gates: pristine supported release and final host; external mail and
enrollment process; production writer ownership, stop/deny/drain; fresh final
export and reviewed plan; complete accepted 60-minute freeze including review
and abort allowance. Fast measured import operations do not prove that window.
Temporary ACL-protected local backups do not prove off-host retention.

Artifact paths, digests, counts and timings are in
[redacted evidence](c08-readiness-2026-10-04.json). Actual records, private logs,
plans, decisions and database backups remain in the protected temporary folder.

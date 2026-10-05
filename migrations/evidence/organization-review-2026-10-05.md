# Organization and Ponytail review — 2026-10-05

Scope: pending dashboard/pagination/rendering changes, auth-body parsing,
directional migration qualification, operator relocation and project root cleanup.
Review was performed locally; independent agents stopped at the account usage
limit before reviewing or editing files.

`migrations/tool/src/cli.ts:L6: delete: obsolete checkpoint/future-command narration. Replace with the current unknown-command refusal contract.`

`net: -2 lines applied.`

No additional complexity cuts were justified. Session generation checks, mutation
locks, row/history validation, explicit seed projections, directional release
admission and receipt/fence recovery checks protect real behavior and remain.
The relocation adds no dispatcher, compatibility wrapper or alternate CLI.

Correctness checks retained the directional Supabase 1.0.3 → native 1.1.6
allowlist, provider/namespace binding, lenient JSON parsing plus field validation,
page-first selection and explicit full-history selection. The application import
guard now rejects both the current operator path and the historical path.

Raw C08 reports, patches, known-hosts, journals and performance logs were moved
into ignored folders, not deleted or staged. Captured helper syntax and relocated
Markdown links were checked. No helper, database operation, production pause,
cluster operation or deployment was executed during organization.

## Verification

- Application coverage: 1,927 passed, 61 skipped; aggregate gates passed.
- Migration coverage: 445 passed, 41 skipped; aggregate gates passed.
- Root and migration types/lint passed; boundary guard: 13 passed.
- Both native and Supabase production builds passed. Supabase's existing
  environment was loaded in memory before its prebuild configuration gate.
- OpenShift source packaging passed (362 files); the filtered context includes
  the moved workspace manifest and excludes local operational data.
- Live integration cases were skipped because no test database/provider target
  was configured. Browser/a11y and container image rebuild were not repeated;
  earlier qualification remains separate evidence, not a new PASS.

The initial sandboxed Vitest attempts failed on temporary-file rename permissions.
The same suites passed outside the sandbox. Private logs remain locally under
`migrations/local/`; only this result summary is versioned.

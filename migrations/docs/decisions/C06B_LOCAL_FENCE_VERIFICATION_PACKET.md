# C06B local fence verification — 2026-10-03

## Decision and scope

Continue the authorized ordered plan with existing native fence integration
tests while hosted recovery provisioning is unavailable. This is a mechanism
check, not deployment shutdown certification. No application source change or
new fence protocol is proposed.

## Verified evidence

- `migrations/tool/tests/migration-provider-fence.int.test.ts` creates and removes
  a disposable loopback database and cluster role `vsis_fence_app`; it tests
  admission, DML revocation, SQL denial, exact grant restoration and readmission.
- `migrations/tool/tests/migration-fence-v6.int.test.ts` creates/removes a
  disposable database matching `vsis_migration_c06b_*`; it tests real application
  gate storage, publication sequencing and crash boundaries. Authentication is
  mocked in that suite, so it is not a live session/auth proof.
- Both suites perform destructive fixture setup; never use an existing database
  or run concurrently with another operator. The fresh C00 destination and all
  existing fixture databases are excluded from their connection inputs.
- Supabase connector tools are absent in the current session. Hosted recovery
  creation remains authorized. The user selected the source organization and
  later restored CLI access by changing login; billing policy confirmation is
  pending. No hosted fence test is selected.

## Lifecycle and acceptance

Generate an unused `vsis_migration_c06b_probe_<timestamp>` database name. Verify
that name and the fixed test role do not exist before invoking the existing
tests. Bind admin and test connections to the running loopback native container;
read connection settings only in memory and never emit them. Run the suites
serially with the native leg explicitly required. Refuse a pre-existing role or
database rather than deleting/reusing it. Afterward, verify the test database and
role are gone and the C00 destination's gate/receipt/data counts match their
pre-test values. If tests or cleanup fail, preserve diagnostics and report the
failure; do not target unrelated databases for repair.

Capture exact pass/skip counts and state checks in C00 evidence. C06B remains
PARTIAL/BLOCKED until both deployments' Auth/admin, jobs, integrations, ingress,
privileged SQL and established sessions have selected controls and live proof.
C07 and C08 prerequisites remain open. No source writes, migration transfer,
publication or production cutover is authorized by this isolated test run.

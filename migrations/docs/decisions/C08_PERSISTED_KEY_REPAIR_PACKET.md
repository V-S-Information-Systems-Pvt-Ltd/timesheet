# C08 persistence invariant and second actual-data repair

Question: how can the operator persist every supported canonical key without changing reviewed bundle/plan digests or single-UUID runtime lookup contracts?

Facts: the first actual-data attempt failed an immediate unique Telegram constraint; reference-merge repair stages changed slots and applies resolved mapped mutations transactionally. The retry failed PostgreSQL UTF8 NUL rejection. `format.ts:primaryKeyOf` joins compound key components with NUL. `import.ts:writeMappings` and `writeDispositions` persist these keys into PostgreSQL text. Readback verification, provider provenance reads, and reverse export currently read those text values directly.

Consolidated invariant: canonical in-memory and artifact keys remain unchanged; durable metadata represents compound keys with a deterministic, reversible, collision-free PostgreSQL-safe encoding. All durable metadata write/read boundaries agree. Single UUID keys remain byte-for-byte unchanged for application portable retry queries. Imported business fields are never stripped or rewritten to bypass an encoding error. Apply remains fenced and atomic; failure restores business rows and receipt metadata.

Scope: operator metadata codec, writes, verification, provider provenance, reverse export, focused regression coverage. No applied schema migrations, source bundle rewrites, production writes, application auth changes, or release compatibility expansion.

Alternatives: changing canonical separators would invalidate reviewed digests/contracts; lossy separator replacement permits collisions. Prefer a tagged reversible boundary representation with explicit escaping of its reserved prefix, preserving ordinary keys.

Acceptance: compound map/disposition keys persist against real PostgreSQL; verify/retry and provenance round trip preserve canonical keys; reverse export is correct; single UUID mappings retain existing behavior; encoding is injective including reserved-prefix input; malformed encoded values fail closed; transaction rollback is demonstrated. Review the whole persistence protocol before implementing a second symptom patch.

Lifecycle: apply under existing gate transaction, verify committed metadata, replay unchanged, export/replan decoded provenance; retain legacy plain single keys. Existing PostgreSQL rows cannot contain literal NUL compound keys, so no successful legacy NUL representation exists to migrate.

Closure finding R1 (reviewer, FACT): materialization computes a compound create's
destination key before parent foreign keys are rewritten. A mapped parent UUID
therefore leaves `idMap` inconsistent with the final expected compound row.
Extend the invariant: durable destination mappings always identify the final
reviewed row after dependency remapping, before destination-claim validation and
digest computation. Repair in the planner and prove remapped-parent apply,
metadata and reverse provenance; do not compensate with importer guesses.
The actual-data rehearsal preserves profile/reminder parent UUIDs, so its passed
reconciliation does not cover R1. One worker owns this bounded closure repair.

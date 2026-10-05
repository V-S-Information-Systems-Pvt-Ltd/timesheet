# Migration operations

| Location | Purpose |
| --- | --- |
| `tool/` | Private `@vsis/migration-tool` workspace: CLI, tests and configuration |
| `docs/` | Current runbooks and plans; `archive/` contains historical decisions |
| `docs/decisions/` | Migration-specific architecture and repair packets |
| `evidence/` | Versioned, sanitized qualification results; capture-time paths are historical |
| `rehearsal/scripts/` | Captured machine-specific C08 helpers; reference material, not a reusable launcher |
| `rehearsal/local/`, `local/` | Ignored raw reports, patches, known-hosts and former root journals |
| `tool/.migration-runs/` | Ignored workspace journals; preserve these for recovery |

Start with the [implementation guide](../docs/guide/MIGRATION_IMPLEMENTATION.md).
Run operator commands from `migrations/tool/`; the CLI does not load `.env.local`.
For a former root invocation, recover with the explicit original run directory
now preserved under `local/root-runs/`; do not create a replacement journal.

Application schema migrations remain in `db/migrations/` and
`supabase/migrations/`. Shared application auth, fences and retry compatibility
remain in their runtime modules. Application code must not import this workspace.

Private dumps, bundles, connection strings, tokens and reset messages belong in
protected local storage, never Git or an application/container build context.
Captured helpers have fixed databases, image digests and private temporary paths;
review their bindings before any reuse. Moving them does not authorize execution.

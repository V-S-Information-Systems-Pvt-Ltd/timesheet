# AI Context Pack

This directory is the compact entry point for coding agents working on VSIS Timesheet. It is a navigation layer over the current source, not a replacement for source code, migrations, tests, `AGENTS.md`, or the fuller `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`.

## Retrieval order

1. Reuse existing task-specific context/current diff.
2. Read `CURRENT_STATE.md`.
3. Read `ARCHITECTURE.md` for substantial architecture-aware work.
4. Read only the task-relevant domain file in this directory.
5. For unfamiliar scope, run Atlas to get a bounded structural map (`atlas . --budget 2048`).
6. Use Serena for symbol definitions/bodies, implementations, references, related symbols, and diagnostics.
7. Read only the source snippets required to verify behavior.
8. Read complete source files only when snippet/symbol evidence is insufficient.
9. Use `.ua/knowledge-graph.json` / Understand Anything when the question is cross-cutting, semantic, or dependency-heavy and the narrower steps are insufficient.
10. Use broad repository exploration only as a last resort.

For architecture decisions, assemble `ARCHITECTURE_DECISION_PACKET_TEMPLATE.md` and escalate only after the cheap retrieval steps above have produced the relevant facts, constraints, alternatives, and unknowns.

## Files

- `CURRENT_STATE.md` — current repository/runtime snapshot and freshness notes.
- `ARCHITECTURE.md` — concise architecture invariants and authoritative references.
- `SYSTEM_MAP.md` — major runtime flows and boundaries.
- `MODULE_INDEX.md` — where to look by subsystem.
- `DATA_MODEL.md` — durable entities and schema ownership.
- `AUTH_SECURITY.md` — authentication, authorization, CSRF, RLS, and rate-limit boundaries.
- `API_CONTRACTS.md` — web, mobile, action, and repository contracts.
- `DEPENDENCY_MAP.md` — important dependency directions and parity edges.
- `CONSTRAINTS.md` — rules that architecture/design changes must preserve.
- `ADR_INDEX.md` — architecture decisions and decision-like documents already present.
- `KNOWN_RISKS.md` — evidence-backed architecture risks and unknowns.
- `ARCHITECTURE_DELTA.md` — small rolling record of architecture-affecting changes.
- `../guides/SAFE_CHANGES.md` — contributor navigation for timesheet rules,
  shared contracts, consumers, ownership, and focused verification.
- `ARCHITECTURE_DECISION_PACKET_TEMPLATE.md` — bounded input for an architecture model.

## Tool status at creation

- Atlas `0.2.1-alpha` maps this repository at roughly 94k LOC / 525 source files and emits a deterministic token-budgeted structural map.
- Serena `1.7.0` is configured as a Codex MCP server with the TypeScript LSP. Validation located `Repository` and its references in `nativeRepository`, `supabaseRepository`, and `repo`.
- RTK `0.49.0` is installed for compact CLI output; its Codex integration is instruction-based in this installed release.
- Understand Anything remains configured under `.ua/`. Its graph JSON is readable; there are no non-`.ua` committed changes between the graph metadata commit and the current HEAD at pack creation.

Evidence: `AGENTS.md`, `README.md`, `.ua/meta.json`, `.ua/knowledge-graph.json`, `.serena/project.yml`, `lib/db/repository.ts`, `lib/db/index.ts`.

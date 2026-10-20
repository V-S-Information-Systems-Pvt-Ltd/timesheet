# AI Context Pack

This directory is the compact entry point for coding agents working on VSIS Timesheet. It is a navigation layer over the current source, not a replacement for source code, migrations, tests, `AGENTS.md`, or the fuller `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`.

## Retrieval order

Follow the "Context retrieval" section of `AGENTS.md`. In short: read `CURRENT_STATE.md`, then only the one domain file below that matches the task, then a code index (Serena / jCodeMunch / Atlas), then targeted source. Source is authoritative.

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
- `ARCHITECTURE_DELTA.md` — recent architecture-affecting changes (newest first; older ones in `archive/`).
- `PULSE_DESIGN_DECISION.md` — current web visual-language decision.
- `archive/` — completed decision packets and older delta entries. Read only when a task explicitly revisits one; never during routine discovery.
- `../guides/SAFE_CHANGES.md` — contributor navigation for timesheet rules,
  shared contracts, consumers, ownership, and focused verification.
- `ARCHITECTURE_DECISION_PACKET_TEMPLATE.md` — bounded input for an architecture model.
- `ASTRA_ARCHITECT.md` — root-level reusable prompt for bounded Astra architecture decisions.

# Decision: native is the destination backend

Status: Accepted for architecture planning (operator decision recorded in `docs/plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md`, 2026-09-23)

## Context

The application currently supports native PostgreSQL and Supabase. A guarded migration programme supports movement between them, but the first production direction and long-term backend must be explicit before simplification removes compatibility code.

## Decision

The first production migration direction is **Supabase → native**. Native is the surviving backend. Supabase remains a supported migration source and, where required, the original-provider recovery target until the separately evidenced retirement gates in the architecture simplification plan are satisfied. The reserved native test database is not a substitute for a Supabase recovery destination when recovering a Supabase → native cutover.

This decision does not authorize C08 rehearsal, C09 production cutover, C10 handoff, or provider retirement. The C00 live inventory, provider fence, recovery capacity, client/retry, and operational gates remain open.

## Consequences

- Continue Supabase security and correctness fixes, additive schema changes, and authorization parity while it serves traffic or remains a supported recovery target. Avoid discretionary new Supabase features.
- Keep migration operator tools and runtime retry compatibility until their separate R1–R3 obligations have evidence. Applied native migrations remain part of the surviving install and upgrade history.
- The operator reports that mobile is not in production. Inventory deployed test/development clients, queued writes, and issued retry tickets before deciding whether a coordinated mobile release or compatibility window is needed.
- Keep browser and mobile API contracts stable during the earlier simplification phases. Record each intentional transport change in its own contract matrix.

## Revisit conditions

Review this decision if the operator changes the target provider, first production direction, or recovery obligation. Provider retirement requires the separate acceptance and authorization described in Phase 4 of `docs/plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md`.

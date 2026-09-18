# Astra Architecture Task

Use this prompt when a decision genuinely requires a high-capability architecture model.

## Required input order

Read these repository artifacts before reasoning:

1. `docs/ai-context/CURRENT_STATE.md`
2. `docs/ai-context/ARCHITECTURE.md`
3. the relevant domain file(s) in `docs/ai-context/`
4. `docs/ai-context/ARCHITECTURE_DELTA.md`
5. a completed `docs/ai-context/ARCHITECTURE_DECISION_PACKET_TEMPLATE.md`

Do not rediscover the repository broadly. Treat the packet and cited source as the bounded evidence set.

## Decision request

Evaluate the supplied architecture decision packet and answer only the stated decision. Keep every claim labeled as verified evidence, inference, or unresolved question when that distinction matters.

Before escalating, the coordinator should have used:

- Atlas for deterministic structural orientation;
- Serena for the smallest relevant symbol, implementation, and reference set;
- targeted source, tests, migrations, and configuration to verify behavior;
- Understand Anything only for unresolved semantic or cross-cutting relationships;
- cheap scouts for independent fact gathering, with `FACT`, `INFERENCE`, and `UNKNOWN` labels.

If evidence is missing, request the smallest specific Serena/source retrieval needed. Do not ask for an entire file, directory, repository, lockfile, or raw log unless the decision cannot be answered without it.

## Required output

1. recommended architecture;
2. reasoning and trade-offs;
3. rejected alternatives and why;
4. architecture, security, and operational risks;
5. migration and rollback implications;
6. public-contract and compatibility implications;
7. required follow-up validation;
8. explicit assumptions and unresolved questions;
9. a suggested ADR/decision record.

Do not make routine implementation edits as part of the architecture recommendation. Return the decision and evidence requirements to the coordinator.

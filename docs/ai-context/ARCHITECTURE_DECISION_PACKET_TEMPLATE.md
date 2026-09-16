# Architecture Decision Request

Use this packet before escalating a question to Astra or another high-capability architecture model. Keep it bounded to the decision.

## Decision Required

<precise architectural question>

## Why This Decision Is Needed

<trigger, desired behavior, acceptance criteria, and non-goals>

## Current Architecture

<only the current layers/flows that participate in the decision>

## Relevant Existing Decisions

<links from `ADR_INDEX.md`, established constraints, prior architecture documents>

## Constraints

- <technical/platform/security/business/deployment/backward-compatibility constraint>

## Evidence

### Repository map evidence

- <Atlas observation + source path>

### Relevant symbols

- `path: symbol` — <Serena definition/reference observation>

### Relevant implementation observations

- `FACT` — <targeted source/test/config observation + source reference>
- `INFERENCE` — <reasoned conclusion + evidence>
- `UNKNOWN` — <unverified fact and how it could affect the decision>

## Architecture Delta

<relevant entries from `ARCHITECTURE_DELTA.md` and the Git range being evaluated>

## Known Risks

- <evidence-backed risk from `KNOWN_RISKS.md` or newly verified evidence>

## Alternatives

### Option A

<mechanics, benefits, costs, migration/rollback, security, operations, compatibility>

### Option B

...

### Option C

...

## Unresolved Questions

- <remaining UNKNOWN and what evidence would resolve it>

## Scout Synthesis

<bounded scout findings labeled FACT / INFERENCE / UNKNOWN with source references>

## Requested Astra Output

Evaluate only the supplied evidence and provide:

1. recommended architecture;
2. reasoning and trade-offs;
3. rejected alternatives and why;
4. architecture/security/operational risks;
5. migration and rollback implications;
6. compatibility and public-contract implications;
7. required follow-up validation;
8. explicit assumptions and unresolved questions;
9. a suggested ADR/decision record.

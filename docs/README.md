# Documentation

Project documentation is grouped by purpose so the repository root remains
focused on source code, configuration, and contributor entry points.

## Guides

- [User guide](guides/USER_GUIDE.md) — day-to-day product usage and
  role-specific workflows.
- [Safe changes guide](guides/SAFE_CHANGES.md) — navigate timesheet rules,
  shared contracts, consumers, ownership, and focused checks.
- [Deployment guide](../deploy/README.md) — container and Kubernetes/OpenShift
  deployment.
- [Mobile client guide](../mobile/README.md) — React Native setup, development,
  and packaging.
- [Supabase guide](../supabase/README.md) — Supabase schema and migration
  workflow.

## Architecture

- [AI context pack](ai-context/README.md) — compact, progressive-disclosure
  context for coding agents, including system/module maps, constraints, risks,
  architecture deltas, and the architecture decision packet template.
- [Architecture context](architecture/AI_ARCHITECTURE_CONTEXT.md) — system
  boundaries and implementation context.
- [Mobile implementation discovery](architecture/mobile-implementation-discovery.md)
  — mobile architecture findings.
- [Unified experience contract](architecture/unified-experience-contract.md) —
  shared web/mobile behavior contract.

## Security

- [Application security review](security/archive/SECURITY_REVIEW.md) — completed
  application attack-surface review and evidence.
- [AgentShield security scan](security/agentshield-scan-2026-09-17.md) — reviewed
  agent/editor configuration findings and their dispositions.

## Plans

Plans document implementation history and future work. Current repository rules
in [AGENTS.md](../AGENTS.md) take precedence over older plan instructions.

### Active

- [Maintainability implementation plan](plans/MAINTAINABILITY_IMPLEMENTATION_PLAN.md)
  — navigation through existing modules, ownership guidance, and focused
  validation, with repository splitting and enforced review rules deferred.
- [Master architecture remediation plan](plans/MASTER_ARCHITECTURE_REMEDIATION_PLAN.md)
  — current plan of record for the remaining cross-backend and mobile release
  gates.
- [Dual-backend modular implementation plan](plans/dual-backend-modular-implementation/PLAN.md)
  — shared application modules, package boundaries, and verification gates.
- [Dual-backend modular remediation plan](plans/dual-backend-modular-remediation/PLAN.md)
  — remediation execution and hosted/platform evidence gates.
- [Overengineering remediation plan](plans/OVERENGINEERING_REMEDIATION_PLAN.md)
  — future simplification candidates, with runtime behavior changes explicitly
  unresolved.

### Historical plan inputs

- [Architecture remediation input](plans/ARCHITECTURE_REMEDIATION_PLAN.md)
- [Repository technical analysis](plans/CODEBASE_ANALYSIS_FOR_CHATGPT.md)
- [Two-agent plan validation](plans/TWO_AGENT_PLAN_VALIDATION.md)
- [Integrated remediation and rollout evidence](plans/archive/INTEGRATED_REMEDIATION_EXECUTION_EVIDENCE.md)
- [Integrated remediation execution plan](plans/archive/INTEGRATED_REMEDIATION_AND_MERGE_EXECUTION_PLAN.md)
- [Code quality audit remediation plan](plans/archive/CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md)
- [Security remediation plan](plans/archive/SECURITY_REVIEW_REMEDIATION_PLAN.md)
  and its [verification notes](plans/archive/SECURITY_REVIEW_REMEDIATION_NOTES.md).
- [Forgot password plan](plans/archive/FORGOT_PASSWORD_IMPLEMENTATION_PLAN.md)
- [Mobile code review findings fix plan](plans/archive/MOBILE_CODE_REVIEW_FINDINGS_FIX_PLAN.md)
- [Mobile Supabase migration history audit](plans/archive/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md)
- [`mobile-dev` → `main` merge plan](plans/archive/MOBILE_DEV_TO_MAIN_MERGE_PLAN.md)

The mobile administration, customization, and parity initiative is grouped in
[plans/archive/mobile-admin-parity/](plans/archive/mobile-admin-parity/). Read in
this order:

1. [Parity plan](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_PLAN.md)
   — the originating plan, split into
   [12 vertical slices](plans/archive/mobile-admin-parity/slices/).
2. [Remediation plan](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_REMEDIATION_PLAN.md)
3. [Follow-up fix plan](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_FOLLOW_UP_FIX_PLAN.md)
4. [Release-blocker fix plan](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_RELEASE_BLOCKER_FIX_PLAN.md)
5. [Review findings fix plan](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md)
6. [Post-remediation review fix plan](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_POST_REMEDIATION_REVIEW_FIX_PLAN.md)
7. [Second review fix plan](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_SECOND_REVIEW_FIX_PLAN.md)

Evidence ledger for the whole initiative:
[implementation notes](plans/archive/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md).

### Archive

Completed and superseded plans, kept for history, in
[plans/archive/](plans/archive/):

- [Application improvement plan](plans/archive/IMPLEMENTATION_PLAN.md)
- [Multiplatform plan](plans/archive/MULTIPLATFORM_IMPLEMENTATION_PLAN.md)
- [Mobile authentication and dashboard plan](plans/archive/MOBILE_AUTH_DASHBOARD_IMPLEMENTATION_PLAN.md)
- [React Native mobile API plan](plans/archive/REACT_NATIVE_MOBILE_API_IMPLEMENTATION_PLAN.md)
- [Performance and efficiency improvement plan](plans/archive/performance-efficiency-improvement-plan.md)
  and its [notes](plans/archive/performance-efficiency-improvement-notes.md)
- [Performance validation corrections plan](plans/archive/performance-validation-corrections-plan.md)
  and its [notes](plans/archive/performance-validation-corrections-notes.md)

## Maintenance

- [Codebase improvement log](maintenance/CODEBASE_IMPROVEMENTS.md) — completed
  audits and maintenance history.

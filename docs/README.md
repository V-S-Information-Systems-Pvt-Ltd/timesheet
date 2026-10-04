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

- [Architecture simplification](plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md),
  [mobile UI follow-ups](plans/MOBILE_UI_USABILITY_IMPROVEMENT_PLAN.md),
  [legacy profile column retirement](plans/PROFILE_FULL_NAME_RETIREMENT_PLAN.md),
  and [Supabase retirement evidence](plans/SUPABASE_RETIREMENT_PLAN.md)
  — remaining implementation, follow-up, or separately authorized retirement work.
- [Supabase/native migration implementation plan](plans/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md)
  — active Prepare / Dry run / Cutover / Observe for the first Supabase-to-native
  transfer; production approval remains separate.
- [Migration pending work](plans/SUPABASE_NATIVE_MIGRATION_NOTES.md#pending-work)
  — current operational checklist; historical results retain their original scope.
- [Actual-data dry run](plans/C08_REHEARSAL_RUNBOOK.md) and
  [freeze/drain and recovery](plans/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md)
  — protected disposable rehearsal, writer controls and verified-only admission.
- [Open release gates](plans/archive/MASTER_ARCHITECTURE_REMEDIATION_NOTES.md#open-release-gates-status-updated-2026-09-13)
  — the full hosted Supabase replay check blocks enabling durable replay;
  branding request-level deduplication evidence also remains open.

### Current assessments

- [Overengineering remediation assessment](plans/archive/OVERENGINEERING_REMEDIATION_PLAN.md)
  — current assessment of the proposed cleanup; no behavior-preserving code
  removal is justified by the reviewed candidates.

### Historical plan inputs

- [Architecture remediation input](plans/archive/ARCHITECTURE_REMEDIATION_PLAN.md)
- [Repository technical analysis](plans/archive/CODEBASE_ANALYSIS_FOR_CHATGPT.md)
- [Two-agent plan validation](plans/archive/TWO_AGENT_PLAN_VALIDATION.md)
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

Historical plans and evidence, including records with open gates, are kept in
[plans/archive/](plans/archive/):

- Supporting migration references archived 2026-10-04:
  [live inventory](plans/archive/C00_LIVE_INVENTORY_2026_10_03.md),
  [native backup/upgrade evidence](plans/archive/C00_BACKUP_AND_UPGRADE_READINESS.md),
  [protected source backup](plans/archive/C00_PROTECTED_SOURCE_BACKUP.md),
  [source restore](plans/archive/C00_SUPABASE_SOURCE_RESTORE.md),
  [recovery target](plans/archive/C00_TIMESHEET_TEST_RECOVERY.md),
  [Vercel inventory](plans/archive/C00_VERCEL_DEPLOYMENT_INVENTORY.md),
  [writer inventory](plans/archive/C00_WRITER_CONTROL_INVENTORY.md), and
  [retry/session contract](plans/archive/C06A_RETRY_SESSION_RECOVERY_CONTRACT.md).
  Evidence and contract limitations retain their recorded scope; unresolved
  checks are not marked complete by archiving.
- Completed implementation/acceptance records:
  [bug audit](plans/archive/CONTINUOUS_BUG_AUDIT.md),
  [mobile loading implementation](plans/archive/MOBILE_LOADING_IMPROVEMENTS.md), and
  [Windows device acceptance](plans/archive/WINDOWS_DEVICE_ACCEPTANCE.md).
  Unmeasured performance and unavailable checks remain recorded limitations.
- [Earlier recursive simplification prompt](plans/archive/antigravity_recursive_codebase_simplification.md)
  — historical input; current repository instructions and active plans govern work.
- Migration snapshots archived 2026-10-04: [old implementation plan](plans/archive/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN_2026_10_04.md),
  [old notes](plans/archive/SUPABASE_NATIVE_MIGRATION_NOTES_2026_10_04.md),
  [old rehearsal](plans/archive/C08_REHEARSAL_RUNBOOK_2026_10_04.md) and
  [old freeze/drain runbook](plans/archive/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK_2026_10_04.md).
  These preserve checkpoint history; active execution follows the four-stage plan.
- [Maintainability implementation plan](plans/archive/MAINTAINABILITY_IMPLEMENTATION_PLAN.md)
  and its [notes](plans/archive/MAINTAINABILITY_IMPLEMENTATION_NOTES.md)
  — safe changes guide and repository navigation.
- [Dual-backend modular implementation plan](plans/archive/dual-backend-modular-implementation/PLAN.md)
  and its [notes](plans/archive/dual-backend-modular-implementation/NOTES.md)
  — shared application modules, package boundaries, and verification gates.
- [Dual-backend modular remediation plan](plans/archive/dual-backend-modular-remediation/PLAN.md)
  and its [notes](plans/archive/dual-backend-modular-remediation/NOTES.md)
  — remediation execution and hosted/platform evidence gates.
- [Dual-backend modular architecture](plans/archive/dual-backend-modular-architecture.md)
  — modular server and shared client architecture specification.
- [Master architecture remediation plan](plans/archive/MASTER_ARCHITECTURE_REMEDIATION_PLAN.md)
  and its [notes](plans/archive/MASTER_ARCHITECTURE_REMEDIATION_NOTES.md)
  — consolidated cross-backend and mobile release gates.
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

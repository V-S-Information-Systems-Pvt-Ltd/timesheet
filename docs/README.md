# Documentation

Project documentation is grouped by purpose so the repository root remains
focused on source code, configuration, and contributor entry points.

## Guides

- [User guide](guides/USER_GUIDE.md) — day-to-day product usage and
  role-specific workflows.
- [Deployment guide](../deploy/README.md) — container and Kubernetes/OpenShift
  deployment.
- [Mobile client guide](../mobile/README.md) — React Native setup, development,
  and packaging.
- [Supabase guide](../supabase/README.md) — Supabase schema and migration
  workflow.

## Architecture

- [Architecture context](architecture/AI_ARCHITECTURE_CONTEXT.md) — system
  boundaries and implementation context.
- [Mobile implementation discovery](architecture/mobile-implementation-discovery.md)
  — mobile architecture findings.
- [Unified experience contract](architecture/unified-experience-contract.md) —
  shared web/mobile behavior contract.

## Security

- [Security review](security/SECURITY_REVIEW.md) — verified controls and open
  items for authentication, mobile credential storage, rate limiting,
  operational endpoints, and transport.

## Plans

Plans document implementation history and future work. Current repository rules
in [AGENTS.md](../AGENTS.md) take precedence over older plan instructions.

### Active

- [Security remediation plan](plans/SECURITY_REVIEW_REMEDIATION_PLAN.md) —
  transport, operational endpoints, distributed rate limiting, and OS-backed
  mobile credential storage. Evidence ledger:
  [verification notes](plans/SECURITY_REVIEW_REMEDIATION_NOTES.md).
- [Forgot password plan](plans/FORGOT_PASSWORD_IMPLEMENTATION_PLAN.md) —
  self-service web password recovery in both backend modes.
- [Mobile code review findings fix plan](plans/MOBILE_CODE_REVIEW_FINDINGS_FIX_PLAN.md)
  — credential storage, secure-storage failure handling, and Windows bundler
  fixes from the `0a7e58d` review.
- [Mobile Supabase migration history audit](plans/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md)
  — which `rotate_mobile_session` body a linked database actually holds.

### Mobile administration, customization, and parity

One multi-round initiative, grouped in
[plans/mobile-admin-parity/](plans/mobile-admin-parity/). Read in this order:

1. [Parity plan](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_PLAN.md)
   — the originating plan, split into
   [12 vertical slices](plans/mobile-admin-parity/slices/).
2. [Remediation plan](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_REMEDIATION_PLAN.md)
3. [Follow-up fix plan](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_FOLLOW_UP_FIX_PLAN.md)
4. [Release-blocker fix plan](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_RELEASE_BLOCKER_FIX_PLAN.md)
5. [Review findings fix plan](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md)
6. [Post-remediation review fix plan](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_POST_REMEDIATION_REVIEW_FIX_PLAN.md)
7. [Second review fix plan](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_SECOND_REVIEW_FIX_PLAN.md)

Evidence ledger for the whole initiative:
[implementation notes](plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md).

### Archive

Completed and superseded plans, kept for history, in
[plans/archive/](plans/archive/):

- [Application improvement plan](plans/archive/IMPLEMENTATION_PLAN.md)
- [Multiplatform plan](plans/archive/MULTIPLATFORM_IMPLEMENTATION_PLAN.md)
- [Mobile authentication and dashboard plan](plans/archive/MOBILE_AUTH_DASHBOARD_IMPLEMENTATION_PLAN.md)
- [React Native mobile API plan](plans/archive/REACT_NATIVE_MOBILE_API_IMPLEMENTATION_PLAN.md)
- [Web/mobile experience unification plan](plans/archive/WEB_MOBILE_EXPERIENCE_UNIFICATION_PLAN.md)
- [Performance and efficiency improvement plan](plans/archive/performance-efficiency-improvement-plan.md)
  and its [notes](plans/archive/performance-efficiency-improvement-notes.md)
- [Performance validation corrections plan](plans/archive/performance-validation-corrections-plan.md)
  and its [notes](plans/archive/performance-validation-corrections-notes.md)

## Maintenance

- [Codebase improvement log](maintenance/CODEBASE_IMPROVEMENTS.md) — completed
  audits and maintenance history.

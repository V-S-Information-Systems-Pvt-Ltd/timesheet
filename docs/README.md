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

- [Application improvement plan](plans/IMPLEMENTATION_PLAN.md)
- [Mobile authentication and dashboard plan](plans/MOBILE_AUTH_DASHBOARD_IMPLEMENTATION_PLAN.md)
- [Multiplatform plan](plans/MULTIPLATFORM_IMPLEMENTATION_PLAN.md)
- [React Native API plan](plans/REACT_NATIVE_MOBILE_API_IMPLEMENTATION_PLAN.md)
- [Web/mobile experience unification plan](plans/WEB_MOBILE_EXPERIENCE_UNIFICATION_PLAN.md)

Plans document implementation history and future work. Current repository
rules in [AGENTS.md](../AGENTS.md) take precedence over older plan instructions.

## Maintenance

- [Codebase improvement log](maintenance/CODEBASE_IMPROVEMENTS.md) — completed
  audits and maintenance history.

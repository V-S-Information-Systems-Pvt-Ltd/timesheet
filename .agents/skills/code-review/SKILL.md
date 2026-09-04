---
name: code-review
description: >-
  Provides structured guidelines and step-by-step procedures for conducting
  comprehensive code reviews across Next.js 16 App Router, React Native mobile,
  dual-backend repositories (PostgreSQL & Supabase), Server Actions, and API routes.
  Use whenever the user requests a code review, PR review, diff analysis, or
  code quality audit.
---

# Code Review Skill

This skill defines the standard procedure for performing comprehensive, rigorous, and actionable code reviews on the VSIS Timesheet project.

---

## Review Procedure

When conducting a code review:

### 1. Scope & Intent Identification
- Determine the scope: whole repository, specific commits (`git log`, `git diff`), staged changes, or target directories/files.
- Read the corresponding plan, PR description, or user intent to understand requirements.

### 2. Dual-Backend Parity & Database Integrity
- **Dual-Backend Parity**: Check that any data access change is implemented identically in:
  - `lib/db/native.ts` (parametrized SQL with explicit actor-based filtering)
  - `lib/db/supabase.ts` (PostgREST client matching RLS and actor constraints)
- **Migrations**: Verify that new migrations exist in both:
  - `db/migrations/NNNN_*.sql` (Native PostgreSQL)
  - `supabase/migrations/<ts>_*.sql` (Supabase)
  - Ensure migrations are strictly additive; applied migrations must never be edited.
- **Transactions & Atomicity**: Verify multi-table writes execute in a single atomic transaction.

### 3. Server Actions & API Route Contracts
- **Auth Gates**: Every Server Action must invoke `requireActiveActor` / `requireActor(allowedRoles)` / `requireSuperAdmin` from `app/actions/_shared.ts`.
- **Error Handling**: Server actions must return `{ error: string | null }` or `{ data, error }` shapes—never throw unhandled exceptions to the client.
- **Rate-Limiting**: Mutation actions and auth routes must enforce rate-limiting.
- **REST v1 Parity**: Mobile v1 routes in `app/api/v1/` must return standard `{ data, error, meta }` envelopes and match TypeScript contracts in `lib/api/v1/contracts.ts` and `mobile/src/api/contracts.ts`. Allow documented CSV/204 success responses where appropriate (e.g., `text/csv; charset=utf-8` file streaming, and HTTP 204 No Content for empty responses).

### 4. Mobile (React Native & Windows) Quality
- **Cross-Platform Compatibility**: Code must run on iOS, Android, and React Native Windows 0.84 (`index.windows.bundle`).
- **Platform Separation & Runtime Purity**: Never import Node.js built-ins (`fs`, `crypto`, `path`, `stream`, etc.) in mobile runtime modules (`mobile/src/**`). Node built-ins are permitted only in Node-only build/test tooling scripts. All platform behavior (secure storage, file exports, sharing, browser linking) must flow exclusively through `mobile/src/platform/`.
- **Token Storage**: Mobile tokens in production must use platform-native secure storage (`react-native-keychain`, RNW PasswordVault). `MemoryTokenStore` is test-only; reject plaintext (`AsyncStorage`) and reject silent production fallbacks to insecure or in-memory stores.
- **Navigation & State**: Verify navigation stack parameter preservation, dirty form guards, and offline banners.
- **Theme & Styling**: Verify accessibility contrast (WCAG AA) in light and dark modes, and dynamic palette derivation.

### 5. Automated Verification Checklist
Run relevant validation checks before concluding the review:
```powershell
# Server unit tests & linters
npm test
npm run lint
npm run typecheck

# Mobile unit tests & Windows bundle
npm --prefix mobile test
npm --prefix mobile run test:windows
npm --prefix mobile run bundle:windows

# Dual-backend Next.js builds
$env:NEXT_PUBLIC_BACKEND="supabase"; npm run build
$env:NEXT_PUBLIC_BACKEND="native"; npm run build
```

---

## Review Output Format

Structure the code review report with the following sections:

1. **Executive Summary**: 2–3 sentences summarizing the changeset and overall readiness (Approve, Request Changes, or Comments).
2. **Key Strengths**: Highlight robust patterns, test coverage, and clean abstractions.
3. **Actionable Findings**: Categorize findings by severity:
   - 🔴 **Critical / Blocker**: Bugs, regressions, security flaws, broken migrations, or broken dual-backend parity.
   - 🟡 **High / Medium**: Edge-case handling, missing test failure modes, performance bottlenecks, or capability mismatches.
   - 🟢 **Low / Polish**: Type enhancements, code readability, comment accuracy, or styling consistency.
4. **Code Suggestions**: Provide concrete before/after diffs for recommended fixes.
5. **Verification Checklist**: Status of linting, typechecking, unit tests, and dual-backend builds.

---
name: security-review
description: >-
  Provides security audit workflows, vulnerability assessment checklists, and
  penetration testing standards across authentication, authorization, cryptographic
  storage, SQL injection, Supabase RLS policies, CSRF, CSV formula injection,
  rate-limiting, and mobile token security. Use whenever the user requests a
  security review, vulnerability assessment, penetration test, or auth/authz audit.
---

# Security Review Skill

This skill defines the security review methodology and vulnerability assessment procedures for the VSIS Timesheet application.

---

## Security Domains & Audit Checklists

### 1. Authentication & Session Management
- **Password Hashing**: Ensure passwords use versioned scrypt (`scrypt$N$r$p$salt$hash`) with timing-safe verification (`crypto.timingSafeEqual`).
- **Cookie Security**: Auth cookies must have `HttpOnly`, `SameSite=Lax` (or `Strict`), and `Secure` (in production).
- **Session Lifecycle**:
  - Refresh token rotation on each refresh.
  - Immediate invalidation on logout and global revocation support (`/api/v1/auth/logout-all`).
  - Scheduled cleanup of expired sessions guarded by `CRON_SECRET`.
- **Timing Attacks**: Password hashing and verification routines must run in constant time regardless of whether the user exists.

### 2. Dual-Axis Authorization Parity
- **Two-Axis Roles**:
  - `permission_role`: `admin` | `pm` | `co` | `user`
  - `hierarchy_role`: `manager` | `team_lead` | `engineer` | `user`
- **Capability Gating**:
  - Super-admin operations (system backfill, branding, workspace default layout) must be gated by `isSuperAdminActor(actor)` / `requireSuperAdmin`.
  - Project management restricted to `admin` / `pm`.
  - Team view and report viewing restricted to authorized leader/manager hierarchy roles or `admin`/`co`.
  - User filtering in reports and timesheet queries must constrain regular users to `actor.id` even if another `userId` is requested.
- **RPC & Database Privileges**:
  - Read-only RPCs must use `SECURITY INVOKER` so RLS applies.
  - If `SECURITY DEFINER` is used, ensure `SET search_path = public`, explicit grants, and actor authorization checks within the function body.

### 3. Injection Prevention & Escaping
- **SQL Injection**:
  - Native Postgres: All queries must use parametrized placeholders (`$1, $2, ...`) via `lib/db/pool.ts`. Never concatenate raw user input into SQL strings.
  - Supabase: Use PostgREST query builders with validated column names and types.
- **CSV Formula Injection (CSV Injection / DDE)**:
  - All CSV export streams must escape leading characters (`=`, `+`, `-`, `@`, `\t`, `\r`) with a leading single quote (`'`) using `lib/csv.ts` or `lib/reports/csv-export.ts`.
- **XSS & Content Security**:
  - Return proper `Content-Type: application/json` or `text/csv; charset=utf-8`.
  - Include `Content-Disposition: attachment; filename="..."` with sanitized filename strings.
  - Ensure HTML rendering escapes all user-supplied content.

### 4. Anti-Abuse & Rate-Limiting
- **IP Extraction**: Use `lib/ip.ts` with trusted proxy validation to avoid spoofed `X-Forwarded-For` headers.
- **Rate-Limiting**:
  - Login attempts, password changes, domain checks, and data mutations must be rate-limited.
  - Check that rate-limit violations return HTTP 429 Too Many Requests with informative retry headers.

### 5. Mobile Client Security
- **Token Storage**:
  - Mobile tokens must be stored in secure platform storage (`react-native-keychain` / `MemoryTokenStore`), never plain `AsyncStorage`.
- **URL & Domain Whitelisting**:
  - Workspace connection URLs must use HTTPS (except local dev HTTP) and reject URLs with embedded user credentials (`user:pass@host`).
- **Memory & Lifecycle**:
  - Sensitive tokens must be cleared from memory on logout/disconnect.
  - Temporary files created during export must be cleaned up in a `finally` block.

---

## Security Review Procedure

1. **Threat Surface Mapping**: Identify all modified entry points (Server Actions, REST API route handlers, RPCs, database queries, and client forms).
2. **Auth & Authz Tracing**: Trace request flow from client request to database query, verifying capability checks at both HTTP handler and database repository levels.
3. **Data Flow & Sanitization Analysis**: Inspect input validation (`lib/validation.ts`), SQL parameter bindings, and output encoding.
4. **Automated Regression Verification**:
   ```powershell
   npx vitest run tests/action-policy.test.ts tests/csrf.test.ts tests/rate-limit.test.ts tests/password-policy.test.ts tests/supabase-migrations.test.ts
   ```

---

## Security Audit Report Format

Structure security review deliverables as follows:

1. **Executive Summary**: Overview of security posture, assessed risk level (Critical / High / Medium / Low / Clean), and critical recommendations.
2. **Threat & Vulnerability Table**:
   | ID | Vulnerability | Severity | CVSS / Impact | Affected Files | Status |
   |:---|:---|:---|:---|:---|:---|
3. **Detailed Findings**:
   - **Vulnerability Description & Attack Scenario**
   - **Impact Assessment**
   - **Exploit Proof of Concept (if applicable)**
   - **Remediation Diff / Solution**
4. **Compliance & Hardening Verification**: Status of RLS tests, security headers, rate limiting, and password policy compliance.

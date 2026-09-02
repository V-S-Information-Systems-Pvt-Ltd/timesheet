# Forgot Password Implementation Plan

## Goal

Add secure, self-service password recovery for the web application in both
backend modes while preserving the existing signed-in **Change Password** flow.
The first mobile release will link to the web recovery flow in the system
browser so the email link and recovery state are handled in one place.

The completed feature must:

- give the same user-facing behavior in `supabase` and `native` modes;
- never reveal whether an email address is registered or active;
- use short-lived, single-use recovery credentials;
- apply the existing password policy on both client and server;
- revoke existing web and mobile sessions after a successful reset;
- keep recovery secrets, SMTP credentials, service-role keys, and raw tokens
  out of browser bundles, API responses, logs, and database rows;
- continue to build and test in both CI backend modes.

## Current State

- `app/page.tsx` supports sign-in and registration, but has no **Forgot
  password?** entry point.
- `app/change-password/page.tsx` requires an authenticated user and their
  current password. It should remain the signed-in password-change flow.
- `lib/auth/client.ts` exposes `changePassword` only.
- Native auth stores scrypt hashes in `profiles.password_hash` and issues a
  seven-day stateless `vsis_session` JWT. There is currently no per-user
  revocation value in that JWT.
- The versioned mobile API has revocable refresh-token families in
  `mobile_sessions`; a password reset must revoke them explicitly.
- Supabase mode uses `@supabase/ssr` with PKCE and can use Supabase Auth's
  managed `resetPasswordForEmail` and `updateUser` flow.
- Native mode has no email transport or recovery-token table.

## Product Decisions

1. **Recovery is email-link based.** The request form always displays:
   `If an account exists for that email, we sent a password reset link.`
2. **Reset and change are separate flows.** `/change-password` continues to
   require the current password; `/forgot-password` and `/reset-password` are
   public recovery routes.
3. **Reset does not activate an account or change roles.** Inactive users may
   reset their password but remain inactive.
4. **Successful reset signs the user out everywhere.** They return to the
   sign-in page and authenticate with the new password.
5. **Mobile MVP uses a web handoff.** A **Forgot password?** link on the mobile
   sign-in screen opens `<APP_BASE_URL>/forgot-password`. Native deep links and
   in-app recovery can be a later enhancement.
6. **Native production recovery requires SMTP.** Use a generic SMTP adapter so
   Docker, OpenShift, Rancher, and local deployments are not tied to one email
   vendor. Use Mailpit only for local/E2E testing.
7. **Administrator-set temporary passwords are out of scope.** That is a
   separate privileged workflow with different authorization and auditing
   requirements.

## Target Flow

### Request

1. User selects **Forgot password?** and submits a normalized email address.
2. The app applies an IP-plus-email rate limit and validates the email shape.
3. The app always returns the same success status and message for known,
   unknown, inactive, recently requested, and rate-limited accounts. A
   `Retry-After` header may be returned internally, but the UI remains generic.
4. Supabase mode asks Supabase Auth to send its recovery email with
   `/reset-password` as the allow-listed redirect.
5. Native mode creates a random recovery token, stores only its SHA-256 digest,
   invalidates older unused tokens for that user, and sends the raw token only
   in the email link.

### Complete

1. The email link opens `/reset-password`.
2. Supabase mode restores the PKCE recovery session and accepts the
   `PASSWORD_RECOVERY` event. Native mode reads the recovery token from the URL
   fragment and submits it in the request body so it is not sent in the initial
   HTTP request or Referer header.
3. The page validates the new password and matching confirmation.
4. The server/provider verifies the recovery credential and updates the
   password.
5. The reset credential is consumed, all mobile sessions are revoked, and all
   web sessions are invalidated.
6. The recovery session is cleared and the user is redirected to sign-in with
   a success message.

## Work Packages

### WP-01 — Shared contracts and validation

- Extend `AuthClient` in `lib/auth/client.ts` with backend-neutral methods:
  - `requestPasswordReset(email)`;
  - `completePasswordReset(input)` with the backend-specific recovery state
    hidden behind the client implementation.
- Reuse `passwordSchema` and `validatePasswordPolicy`; do not create a second
  password policy.
- Add request schemas to `lib/validation-schemas.ts` for normalized email,
  reset token, and new password.
- Add recovery-specific rate-limit constants/stores in `lib/rate-limit.ts`:
  - request: recommended 3 attempts per email+IP per hour;
  - completion: recommended 10 invalid attempts per IP per hour.
- Do not include account existence, active status, user ID, provider errors, or
  token validity in the request response.

### WP-02 — Public web experience

- Add a **Forgot password?** link beside the password field in `app/page.tsx`.
- Add `app/forgot-password/page.tsx`:
  - email-only form;
  - accessible pending, error, and generic-success states;
  - disabled duplicate submission;
  - link back to sign-in.
- Add `app/reset-password/page.tsx`:
  - new password and confirmation fields;
  - the same visible password rules as the current change page;
  - expired/invalid-link state that directs the user to request another link;
  - successful reset state followed by navigation to sign-in.
- Factor a small shared password-fields component only if it reduces duplicate
  validation without coupling the authenticated and recovery flows.
- Add a safe `reset=success` sign-in notice; do not put tokens or provider error
  text in navigation parameters.

### WP-03 — Supabase recovery adapter

- In the Supabase branch of `lib/auth/client.ts`, call
  `supabase.auth.resetPasswordForEmail(email, { redirectTo })` from the browser
  client. This preserves the PKCE verifier managed by `@supabase/ssr`.
- Build `redirectTo` from the configured canonical application URL or the
  current trusted origin; never accept a redirect target from form input.
- On `/reset-password`, listen for `PASSWORD_RECOVERY`, verify the current user
  through Supabase Auth, and call `updateUser({ password })` only after the
  recovery session is established.
- Before the provider password update, call a server-only endpoint that resolves
  the authenticated recovery user and invokes
  `mobileSessionStore.revokeAll(userId)`. Treat revocation failure as blocking;
  revoking mobile sessions before a later provider failure is safe, while doing
  it afterward could leave a valid mobile refresh token if the second step
  fails. Then call `updateUser({ password })`, Supabase global sign-out, and
  clear local recovery state.
- Do not use `SUPABASE_SERVICE_ROLE_KEY` in a Client Component. The existing
  server-only admin client remains the only service-role boundary.
- Configure Supabase Auth:
  - set the production Site URL;
  - allow-list the exact production, staging, and local `/reset-password`
    redirects;
  - configure custom SMTP for production;
  - verify the recovery email template uses the intended redirect;
  - retain provider-side password-reset rate limiting.
- Add an operational note for the PKCE same-browser expectation. If cross-device
  recovery becomes a requirement, add a follow-up design using a customized
  `token_hash` confirmation route rather than weakening PKCE.

### WP-04 — Native recovery persistence

- Create a new native migration; do not edit an applied migration.
- Add `password_reset_tokens` with:
  - UUID primary key;
  - `user_id` foreign key with `ON DELETE CASCADE`;
  - unique SHA-256 `token_hash`;
  - `created_at`, `expires_at`, and nullable `used_at` timestamps;
  - an index supporting active-token lookup and cleanup.
- Add `profiles.session_version integer not null default 0` to invalidate
  stateless native web JWTs per user.
- Keep all password-recovery SQL and transactions under `lib/db/`; application
  and route code must not open a PostgreSQL client directly.
- Add a native recovery store with operations to:
  - issue a token for a normalized email while invalidating older unused tokens;
  - consume a token atomically with `SELECT ... FOR UPDATE`;
  - update the scrypt password hash;
  - increment `session_version`;
  - mark all outstanding reset tokens used/invalid;
  - revoke every active `mobile_sessions` row for the user;
  - periodically delete expired/old consumed tokens.
- Generate 32 random bytes with Node crypto, encode as base64url, and store only
  the SHA-256 digest. Default expiry: 30 minutes.
- The consume transaction must permit exactly one winner when two reset
  submissions race.

### WP-05 — Native web-session revocation

- Add `session_version` to the native session JWT claims.
- Load the current version during sign-in and compare it when resolving the
  native session. A mismatch makes the session invalid.
- Preserve the public `SessionUser` shape returned to clients; keep the version
  an internal server claim.
- Clear the current cookie after a successful reset. Other cookies become
  unusable immediately because their version is stale.
- Add regression coverage proving a token issued before reset fails and a token
  issued after a new sign-in succeeds.

### WP-06 — Native email delivery

- Add a pinned SMTP library and commit the lockfile update.
- Create a server-only email adapter with plain-text and minimal HTML versions.
- Add documented native-mode variables to `.env.example`, `README.md`, and
  deployment secrets/configuration:
  - `APP_BASE_URL` (required for recovery links);
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`;
  - `SMTP_USER`, `SMTP_PASSWORD` when authentication is required;
  - `SMTP_FROM`.
- Construct links only from `APP_BASE_URL`; never trust `Host`, `Origin`, or
  forwarded-host headers when generating security links.
- Do not log the raw token or full reset URL. Log only request outcome category,
  correlation ID, backend, and delivery failure class.
- Treat SMTP failure as an internal operational error while preserving the
  generic public response. Add health/readiness documentation without exposing
  credentials.

### WP-07 — Native route handlers

- Add `POST /api/auth/forgot-password` for native web requests:
  - run `originCheck`;
  - parse and normalize email;
  - apply rate limiting before database/email work;
  - return the same generic response for every account outcome;
  - use the default Node.js runtime.
- Add `POST /api/auth/reset-password`:
  - run `originCheck`;
  - validate token and password;
  - apply completion rate limiting;
  - call the atomic native recovery operation;
  - return one generic invalid-or-expired-link error for all token failures.
- Keep expected validation failures in structured response bodies and reserve
  thrown exceptions for unexpected server failures.
- Add cache-prevention headers to recovery responses and pages.

### WP-08 — Mobile web handoff

- Add **Forgot password?** to `mobile/src/screens/SignInScreen.tsx` in sign-in
  mode only.
- Open the configured workspace URL plus `/forgot-password` in the operating
  system browser. Validate the workspace URL and allow only HTTPS outside local
  development.
- Do not add bearer-auth requirements to recovery endpoints.
- Do not place Supabase keys, SMTP settings, or reset tokens in mobile config or
  storage.
- Add React Native tests for link visibility, URL construction, and failure to
  open the browser.

### WP-09 — Security and observability

- Use a bounded response-time floor/jitter for native request handling so
  obvious database/email timing differences do not become an enumeration
  oracle; do not disclose delivery success to the caller.
- Never log submitted passwords, raw reset tokens, token digests, SMTP
  credentials, Supabase recovery codes, or full recovery URLs.
- Record a structured `auth.password_reset_completed` event with user ID and
  correlation ID only after a successful reset. Avoid audit entries for unknown
  emails.
- Add alerts/metrics for request volume, rate limiting, delivery failures,
  expired-token submissions, and completed resets.
- Confirm CSP, referrer policy, and analytics do not leak recovery URL fragments.
- Add a cleanup path for expired native tokens, either opportunistically during
  issue/consume or through the existing maintenance mechanism; do not require a
  new always-on worker for the MVP.

### WP-10 — Tests and verification

Add focused tests before broad checks.

#### Unit and route tests

- `tests/forgot-password-route.test.ts`
  - valid, malformed, unknown, inactive, repeated, rate-limited, and SMTP-error
    requests return the intended non-enumerating response;
  - cross-origin requests are rejected;
  - raw tokens do not appear in stored rows or logs.
- `tests/reset-password-route.test.ts`
  - happy path;
  - weak password;
  - malformed, expired, consumed, superseded, and concurrent token use;
  - mobile-session revocation and native `session_version` increment;
  - database rollback on any failed atomic step.
- Extend `tests/auth.test.ts`, `tests/auth-routes.test.ts`, and auth-facade tests
  for the new client contract and session-version behavior.
- Add Supabase adapter tests for `resetPasswordForEmail`, recovery-session
  gating, `updateUser`, custom mobile-session revocation, and global sign-out.
- Add migration regression tests for token-table constraints/indexes and ensure
  Supabase migrations do not create custom objects in the managed `auth`
  schema.

#### UI, E2E, and accessibility

- Component tests for request, invalid-link, expiry, password mismatch, and
  success states.
- Native Playwright E2E with Mailpit (or a CI email sink): request a reset,
  retrieve the link, complete reset, prove the old password fails and the new
  password succeeds.
- Supabase smoke test in a configured environment: verify redirect allow-list,
  recovery event, password update, and sign-out behavior.
- Accessibility test keyboard navigation, labels, focus placement, live status,
  and error announcements on both new pages.
- Mobile tests for the browser handoff.

#### Required commands

1. Run each new targeted Vitest file with `npx vitest run tests/<file>`.
2. Run `npm run typecheck` and `npm run lint`.
3. Run `npm test` and `npm run test:coverage`.
4. Run `npm run build` with both `NEXT_PUBLIC_BACKEND=supabase` and `native`.
5. Run native migrations and the password-reset integration/E2E flow against
   PostgreSQL.
6. In `mobile/`, run lint, TypeScript, and Jest.
7. Build the standalone native container and verify SMTP variables are runtime
   configuration, not build-time public values.

## Suggested Delivery Order

1. Shared contracts, UI skeletons, and generic response behavior.
2. Native migration, token store, atomic reset, and session revocation.
3. Native SMTP adapter and native route handlers.
4. Supabase PKCE adapter, redirect configuration, and mobile-session revocation.
5. Mobile web handoff.
6. Focused unit/route tests, then E2E/a11y and dual-mode builds.
7. Documentation, deployment configuration, monitoring, and rollout checklist.

## Rollout Checklist

- Apply the new native migration before deploying native application code.
- Configure and test native SMTP from the deployment environment.
- Set `APP_BASE_URL` to the exact HTTPS production origin.
- Configure Supabase Site URL, exact redirect URLs, custom SMTP, and reset email
  template behavior.
- Confirm the email domain has SPF, DKIM, and DMARC where the SMTP provider
  supports them.
- Verify no recovery secrets appear in logs, analytics, error reporting, mobile
  config, or browser-visible environment variables.
- Run a real recovery for one active and one inactive test account in each
  backend mode.
- Confirm old web sessions and mobile refresh tokens stop working after reset.
- Monitor delivery failures and reset request volume during staged rollout.

## Acceptance Criteria

- A user can request and complete a password reset without knowing the old
  password in both backend modes.
- Request responses do not reveal whether an account exists or is active.
- Native reset tokens expire after 30 minutes, are stored only as digests, and
  can be used once.
- A second request invalidates older unused native links.
- Password policy is identical across registration, change, and reset flows.
- Successful reset does not alter activation, role, hierarchy, or profile data.
- Successful reset invalidates all native web JWTs and every app-managed mobile
  session; Supabase recovery signs out provider sessions globally.
- Unknown, expired, used, and malformed links fail safely without token details.
- Service-role, SMTP, database, and signing secrets remain server-only.
- Web accessibility checks, focused auth tests, full tests, lint, typecheck,
  coverage, native E2E, mobile checks, container build, and both backend builds
  pass.

## Risks and Mitigations

- **Email deliverability:** require production SMTP and domain authentication;
  monitor bounces and failures.
- **Supabase redirect mismatch:** use exact allow-listed URLs and test every
  environment before rollout.
- **PKCE link opened on another device/browser:** document the limitation for
  MVP and use a customized token-hash confirmation route if cross-device
  recovery is required.
- **Enumeration through timing or rate-limit differences:** use identical
  responses, per-email/IP throttling, a bounded timing floor, and no account
  lookup details in logs.
- **Stateless native session remains usable:** gate every resolved session on
  `session_version`, and test old-token rejection.
- **Mobile refresh token survives reset:** make revocation part of the successful
  reset transaction/workflow, not a best-effort UI call.
- **Partial reset:** keep native password update, token consumption, session
  version increment, and mobile revocation in one database transaction.

## Documentation References

- Supabase password recovery:
  https://supabase.com/docs/guides/auth/passwords
- Supabase `resetPasswordForEmail`:
  https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
- Supabase redirect URL configuration:
  https://supabase.com/docs/guides/auth/redirect-urls
- Supabase session termination behavior:
  https://supabase.com/docs/guides/auth/sessions
- Next.js authentication guide:
  `node_modules/next/dist/docs/01-app/02-guides/authentication.md`
- Next.js Route Handlers:
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`

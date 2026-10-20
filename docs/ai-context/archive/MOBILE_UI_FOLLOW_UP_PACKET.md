# Mobile UI follow-up decision packet

## Decision required

Surface the admin timesheet-create outcome accurately and use HomeScreen's existing resolved actor for the own-entry delete affordance. No API, queue, authorization, or theme redesign is in scope.

## Evidence and constraints

- **FACT:** `mobile/src/auth/domains/timesheets.ts:createTimesheet` returns `{ queued: boolean }`; `mobile/__tests__/timesheet-create-outcome.test.ts` covers committed and queued outcomes.
- **FACT:** `mobile/App.tsx:handleEntryCreated` distinguishes committed success from “Saved offline — will sync when you reconnect.” `SettingsAdminScreen.tsx:handleAdminLogTime` previously ignored the outcome.
- **FACT:** `HomeScreen.tsx` already resolves `actor ?? dashboard?.actor` for capability checks but previously used only `actor?.id` for `canDelete`.
- **FACT:** `HomeScreen.tsx` already formats Today's Hours with `formatDateShort`; `home-screen.test.tsx` checks formatted output and absence of raw ISO copy. The plan's date follow-up is stale; no additional date implementation is needed.
- **UNKNOWN:** Physical-device rendering is not verified by Jest. Existing device acceptance remains open.

## Decision and alternatives

Reuse the existing outcome and actor, with no new abstractions. Preserve committed-save copy and form clearing; give queued saves explicit local/offline copy; preserve the draft and show the existing error on rejection. Keep server authorization unchanged. Retain session-actor precedence over dashboard fallback, and never show own-entry delete for a different owner.

Reject queue/API changes: the return contract already supplies the required distinction. Reject theme contrast changes in this patch: they require a separate palette decision. This bounded UI repair needs no architectural escalation or architecture delta.

## Acceptance checks

- Screen tests: committed save, queued save, rejected save (draft retained and no success copy).
- HomeScreen tests: dashboard-only identity, different owner, session identity precedence, no identity.
- Existing date-formatting and outcome regressions remain green.
- Run the standard and Windows Jest suites, mobile lint and TypeScript.
- Record resolved follow-ups in the usability plan without closing its device gates.

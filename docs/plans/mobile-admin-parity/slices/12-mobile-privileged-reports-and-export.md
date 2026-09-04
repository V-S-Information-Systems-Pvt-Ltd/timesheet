# 12 Mobile privileged reports and export

**What to build:** Extend mobile reports for authorized team/all-user scopes and
provide a maintained Android/iOS/Windows path to save or share server-generated
exports without leaking bearer credentials.

**Blocked by:** 01

## Acceptance criteria

- [ ] Admin/CO/leader report scopes and filters match repository visibility;
      PM/engineer/user receive only authorized personal data and controls.
- [ ] Date/project/activity/user grouping, totals, pagination, and member
      drill-down match web semantics and preserve filters across navigation.
- [ ] Export reuses server-authorized report filters, sanitizes filenames/CSV,
      handles empty results, and never embeds long-lived credentials in a URL.
- [ ] A compatibility spike proves the chosen save/share mechanism on Android,
      iOS, and React Native Windows 0.84 before adding a dependency or shipping.
- [ ] Cancellation, offline, timeout, authorization loss, disk/share failure,
      and retry states do not expose or corrupt another user's data.
- [ ] Report service/route/export security tests, dual-backend parity tests,
      mobile report tests, and manual three-platform evidence pass.

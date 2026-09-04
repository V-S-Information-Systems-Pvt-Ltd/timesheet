# 03 Build-time default workspace and theme preference

**What to build:** Add a documented build-time mobile workspace URL that
pre-populates first connection while preserving user overrides. Add a persisted
per-device System/Light/Dark preference that applies before authentication.

**Blocked by:** none, can start immediately

## Acceptance criteria

- [ ] Valid build-time URL pre-populates connection only when no persisted user
      workspace exists; malformed or unsupported URLs are ignored safely.
- [ ] A user can change or disconnect from the default workspace, and their
      persisted choice wins on subsequent launches and upgrades.
- [ ] System is the initial theme mode; explicit Light/Dark overrides survive
      restart, sign-out, workspace changes, and account changes on that device.
- [ ] Status bar and all disconnected, pending, signed-out, and signed-in roots
      use the effective theme without a light-theme flash.
- [ ] No credential, token, or user identity is accepted through the build-time
      parameter.
- [ ] Precedence, persistence, invalid-input, and theme rendering tests pass on
      standard and Windows Jest configurations.

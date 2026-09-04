# 07 Desktop keyboard and cross-platform icon polish

**What to build:** Make desktop Enter-key sign-in behave like pressing Sign In
and render the Timesheets icon at the same perceived size as peer navigation
icons on Android and Windows.

**Blocked by:** none, can start immediately

## Acceptance criteria

- [ ] Email submit moves focus to Password, and Password Enter invokes the same
      guarded submit handler as the button in sign-in mode.
- [ ] Enter during submission cannot create duplicate requests; signup mode
      keeps its validation and explicit submission behavior.
- [ ] Keyboard behavior works with secure text entry and the password
      show/hide control on Windows without regressing mobile keyboards.
- [ ] Timesheets uses the shared icon adapter with consistent container,
      baseline, optical size, active/inactive state, and touch target.
- [ ] The fix does not add an unproved native icon dependency or leave structural
      UI dependent on platform-specific Unicode font metrics.
- [ ] Sign-in interaction, navigation icon snapshot/layout, Android, and Windows
      tests pass.

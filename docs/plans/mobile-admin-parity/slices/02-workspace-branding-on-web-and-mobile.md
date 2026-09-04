# 02 Workspace branding on web and mobile

**What to build:** Let super-admin configure the in-app product name, accessible
primary color, and HTTPS logo URL for a workspace. Apply the configuration to
web and mobile signed-out/signed-in surfaces with independent bundled fallbacks.

**Blocked by:** 01

## Acceptance criteria

- [ ] Super-admin can read, validate, save, and reset branding from web and the
      mobile admin module; other roles receive 403 and cannot mutate settings.
- [ ] Workspace config exposes only safe branding fields and remains compatible
      with clients that do not know them.
- [ ] Invalid URL, non-HTTPS URL, overlong values, malformed color, and unsafe
      action contrast are rejected with field errors.
- [ ] A failed remote image or missing setting falls back without blocking
      workspace connection or sign-in.
- [ ] Runtime branding does not claim to modify native launcher/store metadata.
- [ ] Dual-backend route/repository tests, theme contrast tests, and web/mobile
      rendering tests pass.

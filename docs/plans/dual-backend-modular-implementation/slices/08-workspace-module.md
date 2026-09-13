# 08 Workspace behavior is shared end to end

**What to build:** Settings, branding, and layouts use one workspace application service and canonical contracts while rendering, theme application, and storage remain platform-specific.

**Blocked by:** 03.

## Approach

- Characterize settings visibility/update, branding defaults/reset, user/default layouts, capability gates, and cache behavior.
- Add the workspace service and provider ports; keep logo proxy/CSP, React rendering, native theming, and local preference storage in their platform layers.
- Route actions, compatibility endpoints, versioned endpoints, and shared-client calls through the service.
- Share DTOs, validation, design constants, and platform-neutral layout/state transformations only where semantics match.
- Preserve existing caching and request memoization behavior; measure query/latency effects rather than assuming improvement.

## Acceptance criteria

- [ ] Settings, branding, and layouts have one orchestration/policy owner with provider parity.
- [ ] Web and mobile retain their platform-specific rendering, theme, logo delivery, and storage behavior.
- [ ] Default/user layout precedence and capability gates remain compatible for both role axes.
- [ ] Remote branding retains CSP/SSRF protections and safe fallback behavior.
- [ ] Existing DTOs, endpoint URLs, actions, and cached/default states remain compatible.

## Verification

```powershell
npx vitest run tests/branding.test.ts tests/branding-logo-proxy.test.ts tests/layout.test.ts tests/supabase-layouts.test.ts tests/mobile-branding-route.test.ts tests/mobile-layout-route.test.ts
Push-Location mobile
npm test -- --runTestsByPath __tests__/branding.test.tsx __tests__/layout-customizer-screen.test.tsx __tests__/default-workspace-and-theme.test.tsx __tests__/workspace-brand-shell.test.tsx
Pop-Location
```

Expected: service parity and platform-specific branding/layout behavior pass, including security fallbacks.

## STOP conditions

- Sharing a layout/branding primitive requires platform branches or pulls rendering/storage into shared packages.
- Existing cache behavior cannot be preserved without cross-request identity leakage.

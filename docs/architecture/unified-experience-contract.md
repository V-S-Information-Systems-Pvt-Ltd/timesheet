# Unified Experience Contract: Web & Mobile

This document establishes the canonical vocabulary, state model, design tokens, component contracts, and accessibility specifications shared between the VSIS Timesheet web application and mobile applications (Android, iOS, and Windows).

---

## 1. Canonical Vocabulary

All user interfaces, labels, error messages, and tests must adhere to these canonical terms:

| Concept | Canonical Label | Prohibited Variants |
| :--- | :--- | :--- |
| **Product** | `VSIS Timesheet` | Timesheet Pro, Time Tracker |
| **Root Destination** | `Dashboard` | Home, Overview |
| **Create Entry** | `Log Time` | Add Hours, New Entry |
| **Entry Collection** | `Timesheets` | My Logs, Time Logs |
| **Personal Absence** | `Mark Leave` | Request Leave, Time Off |
| **Team Directory** | `Team` | Employees, Staff Directory |
| **User Settings / Security** | `Profile` | Account, Settings |
| **Destructive Entry Action** | `Delete Entry` | Remove, Drop |
| **Successful Create Feedback** | `Time entry saved` | Saved!, Entry Created |

---

## 2. Standardized 9-State Lifecycle Model

Every data-driven surface must handle and distinguish these 9 states explicitly:

1. **Initial Loading**: Stable skeleton or loading indicator with clear message. Never flash empty states during initial fetch.
2. **Refreshing / Background Refetch**: Preserve visible rows/content while displaying non-blocking refresh indicator.
3. **Empty**: Successful response containing zero entries. Displays contextual empty icon, title, description, and primary CTA.
4. **Error**: Network or server failure. Never disguised as an empty collection. Displays clear error message and a `Retry` button.
5. **Offline / Stale**: Displays cached data with timestamp indicator. Mutation triggers are disabled with explicit reason.
6. **Submitting**: Form inputs and submit triggers locked immediately to prevent duplicate submissions. Displays progress state.
7. **Success**: Non-blocking toast notification or live announcement; smoothly redirects or resets form.
8. **Destructive Confirmation**: Modal/dialog requiring explicit confirmation before permanent deletion or irreversible state change.
9. **Dirty Form Guard**: Unsaved change warning when attempting to navigate away with modified input fields.

---

## 3. Design Tokens & Semantic Color Palette

### Brand & Accents
- **Primary / Brand Action**: VSIS Crimson (`#E4282F` default, `#C01E25` dark/active, `#FFF1F2` light tint, `#FFFFFF` text on primary).
- **Information / Notice**: Blue (`#2457D6` default, `#1A43AC` dark, `#EEF2FD` light tint, `#FFFFFF` text on info).
- **Success**: Emerald (`#10B981` default, `#059669` dark, `#ECFDF5` light tint, `#133529` dark container).
- **Warning**: Amber (`#F59E0B` default, `#D97706` dark, `#FFFBEB` light tint, `#382B14` dark container).
- **Destructive**: Rose / Red (`#E11D48` default, `#BE123C` dark, `#FFF1F2` light tint, `#3A1E1E` dark container).

### Surfaces & Typography
- **Light Theme**:
  - Background: `#F8FAFC` (Slate 50)
  - Card / Surface: `#FFFFFF`
  - Foreground / Text Primary: `#0F172A` (Slate 900, contrast > 18:1)
  - Text Secondary / Muted: `#526077` (Slate 600, contrast > 4.6:1 against card/bg)
  - Border: `#E2E8F0` (Slate 200)
  - Placeholder: `#64748B` (Slate 500)
- **Dark Theme (Mobile)**:
  - Background: `#0F172A` (Slate 900)
  - Card / Surface: `#1E293B` (Slate 800)
  - Foreground / Text Primary: `#F8FAFC` (Slate 50, contrast > 14:1)
  - Text Secondary / Muted: `#94A3B8` (Slate 400, contrast > 5.2:1 against card/bg)
  - Border: `#334155` (Slate 700)
  - Placeholder: `#94A3B8` (Slate 400)

### Spacing Scale (4/8 Rhythm)
- `xs`: 4px / 4pt
- `sm`: 8px / 8pt
- `md`: 12px / 12pt
- `lg`: 20px / 20pt
- `xl`: 28px / 28pt
- `xxl`: 36px / 36pt

### Border Radius
- `xs`: 4px
- `sm`: 8px
- `md`: 12px
- `lg`: 16px
- `xl`: 20px
- `round`: 9999px (circular / pills)

---

## 4. Accessibility & Platform Standards

1. **Color Contrast (WCAG AA)**:
   - Normal text (<18pt / <14pt bold): minimum **4.5:1** contrast ratio against containing surface.
   - Large text (≥18pt / ≥14pt bold) and meaningful UI controls: minimum **3.0:1** contrast ratio.
2. **Touch Targets**:
   - iOS: Minimum **44 × 44 pt**.
   - Android: Minimum **48 × 48 dp**.
   - Compact visual controls must expand their touch area using `hitSlop` or container padding.
3. **Reduced Motion**:
   - Query `AccessibilityInfo.isReduceMotionEnabled()` (mobile) and `@media (prefers-reduced-motion: reduce)` (web).
   - Collapse springs, translations, and multi-step animations to instantaneous transitions when enabled.
4. **Focus & Keyboard Navigation**:
   - Web & Windows: 2px visible focus ring (`outline: 2px solid #E4282F; outline-offset: 2px`).
   - Modal dialogs: Trap focus inside modal, return focus to trigger on close.
5. **No Structural Emoji Icons**:
   - All navigation, actions, and status indicators must use consistent vector glyphs/symbols (`Icon.tsx` on mobile, `@/app/components/icons` on web). Raw emoji characters are prohibited for structural UI.

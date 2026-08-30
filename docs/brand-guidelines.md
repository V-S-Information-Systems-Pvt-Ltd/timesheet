# VSIS Brand Guidelines v1.0

> Last updated: 2026-08-30
> Status: Official

## Quick Reference

| Element | Value |
|---------|-------|
| Primary Color | #E4282F |
| Secondary Color | #3A3F44 |
| Accent Color | #FB6B76 |
| Primary Font | Geist Sans / Inter / System UI |
| Brand Voice | Authoritative, Precise, Reliable, Dynamic |

---

## 1. Brand Concept & Identity

**VSIS (V S Information Systems)** is a premier enterprise IT solutions and systems integration provider. The brand identity reflects precision, high velocity, and robust enterprise engineering.

The brand mark features a dynamic aerodynamic dual-swoosh shield:
- **Charcoal Arc**: Represents structural stability, enterprise strength, and engineering foundation.
- **Crimson Red Blade**: Represents agility, innovation, speed, and continuous forward momentum.
- **Wordmark**: Precision geometric typography in corporate charcoal.

---

## 2. Color Palette

### Primary Colors (VSIS Crimson)

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Primary Red | #E4282F | rgb(228, 40, 47) | Main brand mark, primary CTAs, active highlights |
| Primary Dark | #C01E25 | rgb(192, 30, 37) | Hover states, active buttons, emphasis |
| Primary Deep | #881921 | rgb(136, 25, 33) | Dark accent, active borders |
| Primary Light | #FB6B76 | rgb(251, 107, 118) | Badges, secondary highlights |
| Primary Subtle | #FFF1F2 | rgb(255, 241, 242) | Light tint backgrounds, active item backgrounds |

### Secondary Colors (VSIS Corporate Charcoal)

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Charcoal Dark | #30353A | rgb(48, 53, 58) | Primary typography, headers, main logo body |
| Charcoal Mid | #4E555B | rgb(78, 85, 91) | Secondary typography, icons, emblem top wing |
| Charcoal Light | #60676D | rgb(96, 103, 109) | Subheadings, subtle icons |

### Neutral Palette

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Surface Background | #F8FAFC | rgb(248, 250, 252) | Application page background |
| Card Background | #FFFFFF | rgb(255, 255, 255) | Cards, modals, elevated surfaces |
| Text Primary | #0F172A | rgb(15, 23, 42) | High-contrast body text |
| Text Muted | #64748B | rgb(100, 116, 139) | Captions, secondary labels |
| Border Default | #E2E8F0 | rgb(226, 232, 240) | Cards, inputs, table borders |

### Semantic Colors

| State | Hex | Usage |
|-------|-----|-------|
| Success | #16A34A | Approved entries, successful saves |
| Warning | #D97706 | Approaching daily limit, pending status |
| Danger | #E11D48 | Exceeded cap, delete actions, errors |
| Info | #2563EB | Informational banners, links |

---

## 3. Typography

```css
--font-heading: var(--font-geist-sans), Inter, system-ui, sans-serif;
--font-body: var(--font-geist-sans), Inter, system-ui, sans-serif;
--font-mono: var(--font-geist-mono), monospace;
```

---

## 4. Logo Assets & Usage Rules

### Assets

- Full Horizontal Logo: `public/brand/vsis-logo.svg`, `public/vsis-logo.svg`
- Icon / Emblem Only: `public/brand/vsis-mark.svg`

### Minimum Clearspace & Sizing

- Maintain clearspace around the logo equal to at least 25% of the emblem height (`0.25H`).
- Minimum display height for full horizontal logo: `28px` (digital), `10mm` (print).
- Minimum display size for icon / favicon: `20px` x `20px`.
- Do not stretch, distort, re-color the red blade, or alter the typographic kerning of VSIS.

# VSIS Brand Guidelines v2.0

> Last updated: 2026-08-30
> Source: [vsis.lk](https://vsis.lk/) (Firecrawl branding extraction and official site assets)
> Status: Official application profile

## Quick Reference

| Element | Value |
|---|---|
| Theme | VSIS Enterprise Technology |
| Primary Color | #1E73BE |
| Secondary Color | #EA2B32 |
| Accent Color | #1BB0CE |
| Text Color | #3D3D3D |
| Background | #FFFFFF |
| Primary Font | Work Sans |
| Brand Voice | Professional, clear, reliable, forward-looking |
| Corporate Line | Transforming technology to business success |

## 1. Brand Concept & Identity

VSIS presents itself as an enterprise ICT solutions partner that turns technology into measurable business outcomes. Application experiences should feel professional, dependable, efficient, and modern. Keep interfaces calm and task-focused; use brand color to establish hierarchy rather than decoration.

## 2. Color Palette

### Primary Colors (VSIS Action Blue)

| Name | Hex | Usage |
|---|---|---|
| Primary Blue | #1E73BE | Primary actions, selected navigation, links, focus states |
| Primary Dark | #185B98 | Hover and pressed states |
| Primary Light | #EFF8FF | Selected rows, badges, subtle information surfaces |

### Secondary Colors (VSIS Corporate Red)

| Name | Hex | Usage |
|---|---|---|
| Secondary Red | #EA2B32 | Corporate accent, logo, branded highlights |
| Secondary Dark | #CF1F26 | Strong accent and pressed treatment |
| Secondary Light | #FFF1F2 | Subtle branded backgrounds |

### Accent Colors (VSIS Cyan)

| Name | Hex | Usage |
|---|---|---|
| Accent Cyan | #1BB0CE | Supporting highlights and visual atmosphere |
| Accent Dark | #118DA8 | High-contrast accent treatment |
| Accent Light | #EDFCFF | Decorative and low-emphasis backgrounds |

### Neutral Palette

| Name | Hex | Usage |
|---|---|---|
| Background | #FFFFFF | Site-aligned base surface |
| App Surface | #F8FAFC | Workspace background |
| Text Primary | #3D3D3D | Headings and body copy |
| Text Muted | #64748B | Supporting copy |
| Border | #E2E8F0 | Controls and separators |

### Semantic Colors

| Name | Hex | Usage |
|---|---|---|
| Success | #10B981 | Successful outcomes |
| Warning | #F59E0B | Caution and pending states |
| Danger | #E11D48 | Errors and destructive actions |

Red is a corporate accent, not the destructive semantic. Destructive UI continues to use rose so brand emphasis and danger remain distinguishable.

## 3. Typography

```css
--font-heading: "Work Sans";
--font-body: "Work Sans";
--font-mono: "Geist Mono";
```

- Web heading and body: self-hosted Work Sans, weights 100–900.
- Code and tabular identifiers: Geist Mono.
- Native applications: platform system font until Work Sans is linked for every supported native target.
- Prefer sentence case, short labels, and direct professional language.

## 4. Logo Assets & Usage

- Canonical source: `https://vsis.lk/wp-content/uploads/2020/09/Vector-scaled.jpg`
- Web source copy: `public/brand/vsis-logo.jpg`
- Web compact derivative: `public/brand/vsis-logo-compact.jpg`
- Native compact derivative: `mobile/src/assets/vsis-logo.jpg`
- Site favicon source: `app/icon.png`

The logo must retain its white background, original proportions, twin gray/red arcs, and wordmark. Do not reconstruct, recolor, stretch, or crop into the wordmark. Keep clearspace of at least 20% of the displayed logo height.

## 5. Messaging

Use the live corporate line exactly: **Transforming technology to business success.** Product copy should connect that promise to the task at hand with concrete, concise language, such as “Simple, reliable time tracking for VSIS teams.”

### Brand Personality

| Trait | Expression |
|---|---|
| **Professional** | Clear, capable, and appropriate for enterprise teams |
| **Reliable** | Specific, steady, and transparent about system state |
| **Forward-looking** | Modern and optimistic without speculative hype |

### Core Attributes

| Attribute | Description |
|---|---|
| **Clarity** | Make tasks and outcomes immediately understandable |
| **Efficiency** | Respect users' time and reduce unnecessary steps |
| **Credibility** | Prefer concrete language and authentic imagery |

### Forbidden Phrases

- "Revolutionary" — use “modern” or “improved.”
- "Magical" — use “automated” or “streamlined.”
- "Disruptive" — use “transformative.”

## 6. AI Image Generation

### Base Prompt Template

```
Professional enterprise technology environment, Sri Lankan business context, clean white space, VSIS action blue and cyan lighting with restrained corporate red accents, credible people and infrastructure, modern and reliable, no invented logos.
```

### Style Keywords

| Category | Keywords |
|---|---|
| **Mood** | professional, credible, precise, modern |
| **Palette** | clean white, action blue, cyan, restrained red |
| **Subject** | enterprise technology, collaboration, infrastructure |

### Visual Mood Descriptors

- Confident and calm
- Technically capable
- Human and credible
- Clean and spacious

### Visual Don'ts

| Avoid | Reason |
|---|---|
| Futuristic clichés | Weakens enterprise credibility |
| Excessive gradients | Competes with product information |
| Neon cyberpunk styling | Conflicts with the professional tone |
| Synthetic logo marks | Misrepresents the official identity |

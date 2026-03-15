# CUBE CSS Token Rename Log

**Date:** 2026-03-14
**Scope:** `packages/client/src/` — CSS, TSX, TS, JS, MDX files
**Build:** Verified — `npm run build -w packages/client` succeeds, dev server serves HTTP 200

---

## Token Rename Map (Before → After)

### Surfaces

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-void` | `--color-surface-sunken` | `oklch(0.1 0.02 250)` |
| `--color-base` | `--color-surface` | `oklch(0.15 0.024 250)` |
| `--color-raised` | `--color-surface-raised` | `oklch(0.205 0.028 250)` |
| `--color-elevated` | `--color-surface-elevated` | `oklch(0.26 0.032 250)` |
| `--color-row-stripe` | `--color-row-stripe` (kept) | `var(--color-surface)` (ref updated) |

### Text

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-fg` | `--color-text` | `oklch(0.93 0.008 250)` |
| `--color-fg-2` | `--color-text-muted` | `oklch(0.65 0.015 250)` |
| `--color-fg-3` | `--color-text-faint` | `oklch(0.44 0.012 250)` |

### Borders

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-line` | `--color-border` | `oklch(0.26 0.02 250)` |
| `--color-line-2` | `--color-border-strong` | `oklch(0.34 0.024 250)` |

### Interactive (Cyan)

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-cyan` | `--color-interactive` | `oklch(0.75 0.18 195)` |
| `--color-cyan-hover` | `--color-interactive-hover` | `oklch(0.8 0.18 195)` |
| `--color-cyan-dim` | `--color-interactive-dim` | `oklch(0.54 0.12 195)` |
| `--color-cyan-wash` | `--color-interactive-wash` | `oklch(0.22 0.04 195)` |

### Secondary (Violet)

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-violet` | `--color-secondary` | `oklch(0.62 0.15 280)` |
| `--color-violet-dim` | `--color-secondary-dim` | `oklch(0.44 0.1 280)` |
| `--color-violet-wash` | `--color-secondary-wash` | `oklch(0.2 0.04 280)` |

### Warning (Amber + Yellow collapsed)

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-amber` | `--color-warning` | `oklch(0.75 0.185 60)` |
| `--color-amber-hover` | `--color-warning-hover` | `oklch(0.8 0.185 60)` |
| `--color-amber-dim` | `--color-warning-border` | `oklch(0.54 0.12 60)` |
| `--color-amber-wash` | `--color-warning-subtle` | `oklch(0.22 0.04 60)` |
| `--color-yellow` | **deleted** (collapsed into `--color-warning`) | was `oklch(0.75 0.16 85)` |

### Danger (Red)

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-red` | `--color-danger` | `oklch(0.65 0.2 25)` |
| `--color-red-dim` | `--color-danger-border` | `oklch(0.35 0.1 25)` |
| `--color-red-wash` | `--color-danger-subtle` | `oklch(0.2 0.04 25)` |

### Success & Status

| Before | After | Value (unchanged) |
|---|---|---|
| `--color-green` | `--color-success` | `oklch(0.64 0.17 145)` |

### Glows

| Before | After | Value (unchanged) |
|---|---|---|
| `--glow-cyan` | `--glow-interactive` | `0 0 24px oklch(0.75 0.18 195 / 0.25)` |
| `--glow-cyan-sm` | `--glow-interactive-sm` | `0 0 12px oklch(0.75 0.18 195 / 0.2)` |
| `--glow-violet` | `--glow-secondary` | `0 0 24px oklch(0.62 0.15 280 / 0.2)` |
| `--glow-violet-sm` | `--glow-secondary-sm` | `0 0 12px oklch(0.62 0.15 280 / 0.15)` |
| `--glow-focus` | `--glow-focus` (kept) | composite shadow value — not a simple color |

---

## New Tokens Added

| Token | Value | Reason |
|---|---|---|
| `--color-accent` | `var(--color-interactive)` | Alias per resolved decision: cyan = interactive AND accent |
| `--color-accent-dim` | `var(--color-interactive-dim)` | Alias for subdued accent |
| `--color-text-inverse` | `var(--color-surface-sunken)` | Flagged as missing in audit (text on interactive backgrounds) |
| `--color-selection` | `oklch(0.75 0.18 195 / 0.25)` | Flagged as missing in audit (text selection highlight) |

**Note on `--color-selection`:** The instruction specified `var(--neutral-700)` but GenomeHub has no `--neutral-*` scale. Substituted `oklch(0.75 0.18 195 / 0.25)` — interactive cyan at 25% opacity, consistent with the dark-mode palette. Adjust if E2P's `--neutral-700` is integrated later.

---

## Tailwind Utility Renames (Automatic)

Every `--color-*` token generates Tailwind v4 utility classes. All utility references were renamed:

| Before | After | Example |
|---|---|---|
| `text-cyan` | `text-interactive` | headings, links |
| `text-fg` | `text-text` | body text |
| `text-fg-2` | `text-text-muted` | secondary text |
| `text-fg-3` | `text-text-faint` | placeholders, ghost labels |
| `bg-base` | `bg-surface` | backgrounds |
| `bg-raised` | `bg-surface-raised` | cards |
| `bg-elevated` | `bg-surface-elevated` | modals |
| `bg-void` | `bg-surface-sunken` | deepest background |
| `border-line` | `border-border` | standard borders |
| `border-line-2` | `border-border-strong` | heavy borders |
| `border-red` | `border-danger` | danger borders |
| `border-green` | `border-success` | success borders |
| `text-red` | `text-danger` | error text |
| `text-green` | `text-success` | success text |
| `text-yellow` | `text-warning` | warning text |
| `text-violet` | `text-secondary` | secondary accent |
| `border-l-red` | `border-l-danger` | embed card left border |
| `border-l-yellow` | `border-l-warning` | embed card left border |
| `border-l-green` | `border-l-success` | embed card left border |

Hover/focus/group variants (`hover:text-interactive`, etc.) were handled automatically since the base utility name is matched as a substring.

---

## Files Modified (38 total)

### CSS
- `index.css` — token definitions, all component classes

### TSX/TS
- `App.tsx`, `main.tsx`
- `ui/recipes.ts`, `ui/HashChip.tsx`, `ui/Stepper.tsx`, `ui/RiverGauge.tsx`
- `ui/ComboBox.tsx`, `ui/ChipEditor.tsx`, `ui/InlineInput.tsx`
- `ui/Materials.mdx`
- `ui/*.stories.tsx` (RiverGauge, Stepper, InlineInput, HashChip, ComboBox, Input, Badge, Button, Text)
- `components/RangeSlider.tsx`, `components/QueryWorkbench.tsx`
- `components/EnginePanel.tsx`, `components/FilePreview.tsx`
- `components/GlobalUploadProgress.tsx`, `components/JsonHeadPreview.tsx`
- `components/ServiceIcon.tsx`, `components/ConfirmDialog.tsx`
- `components/LinkChip.tsx`, `components/Breadcrumbs.tsx`
- `pages/FileDetailPage.tsx`, `pages/FilesPage.tsx`, `pages/UploadPage.tsx`
- `pages/DevRangePage.tsx`, `pages/DemoPage.tsx`, `pages/ErrorsPage.tsx`
- `pages/CollectionsPage.tsx`, `pages/CollectionDetailPage.tsx`
- `pages/DashboardPage.tsx`, `pages/SettingsPage.tsx`
- `pages/OrganismsPage.tsx`, `pages/LoginPage.tsx`
- `hooks/useDataProfile.ts`, `hooks/useFileQuery.ts`
- `lib/formats.ts`, `lib/SpringAnimator.ts`, `lib/AnimationTicker.ts`

---

## Not Renamed (Out of Scope)

| Item | Reason |
|---|---|
| `.amber-glow` CSS class name | CSS class, not a `--color-*` token |
| `.pip-*` CSS classes (hex colors) | Categorical data viz — not design tokens |
| `CANVAS_CYAN`, `CANVAS_AMBER` JS constants | Canvas drawing — raw OKLCH values, not CSS tokens |
| `AMBER_GLOW`, `CYAN_GLOW` JS constants | Inline box-shadow — raw OKLCH values |
| `ServiceIcon.tsx` brand hex colors | Third-party brand colors (Jira, Slack, etc.) |
| `LoginPage.tsx` Google logo SVG fills | Google brand spec |
| `colorTransitionLogger.js` debug colors | Dev-only console styling |
| `colors.ts` `hashColor()` function | Dynamic color generation — no token refs |
| `--glow-focus` | Composite shadow value, not a simple color token |
| `--color-row-stripe` | Kept as semantic alias, value auto-updated to `var(--color-surface)` |

---

## Section Comment Updates

| Before | After |
|---|---|
| `/* ── Accent — Electric Cyan (hue 195) ── */` | `/* ── Interactive — Electric Cyan (hue 195) ── */` |
| `/* ── Error — Red (hue 25) ── */` | `/* ── Danger — Red (hue 25) ── */` |
| `/* ── Semantic ── */` | `/* ── Success ── */` (yellow collapsed into warning, only success remains) |

---

## Yellow → Warning Collapse

`--color-yellow` (hue 85) was deleted. All references now use `--color-warning` (hue 60, formerly amber). This changes the rendered color for anything that previously used `--color-yellow`:

- Badge `color="yellow"` variant → now uses hue 60 instead of 85
- Embed card `color="yellow"` variant → `border-l-warning` (hue 60)

This was a deliberate design decision per the resolved open question: "Amber vs yellow: collapse yellow into --color-warning. It's a badge color, not a separate intent."

---

---

## Pass 2: Raw Color Subsumption

After the mechanical rename, a second pass replaced raw OKLCH values with token references where the values matched or closely approximated existing tokens.

### CSS `color-mix()` Replacements (index.css)

| Location | Before | After |
|---|---|---|
| `.input-focus-glow` | `oklch(0.75 0.18 195 / 0.15)` | `color-mix(in srgb, var(--color-interactive) 15%, transparent)` |
| `.logo-glow` | `oklch(0.75 0.18 195 / 0.3)` | `color-mix(in srgb, var(--color-interactive) 30%, transparent)` |
| `.sigil:hover bg` | `oklch(0.75 0.18 195 / 0.10)` | `color-mix(in srgb, var(--color-interactive) 10%, transparent)` |
| `.sigil:hover border` | `oklch(0.75 0.18 195 / 0.30)` | `color-mix(in srgb, var(--color-interactive) 30%, transparent)` |
| `.amber-glow` | `oklch(0.750 0.185 60 / 0.28)` | `color-mix(in srgb, var(--color-warning) 28%, transparent)` |
| `.river-impact` | `oklch(0.75 0.18 195 / 0.6)` | `color-mix(in srgb, var(--color-interactive) 60%, transparent)` |
| `@keyframes riverImpactFlash 0%` | `oklch(0.85 0.18 195 / 0.8)` | `color-mix(in srgb, var(--color-interactive-hover) 80%, transparent)` |
| `@keyframes riverImpactFlash 100%` | `oklch(0.75 0.18 195 / 0.2)` | `color-mix(in srgb, var(--color-interactive) 20%, transparent)` |
| `@keyframes flourishLabel` | `oklch(0.75 0.18 195 / 0.3)` | `color-mix(in srgb, var(--color-interactive) 30%, transparent)` |
| `.range-track` | `oklch(0.13 0.01 240 / 0.5)` | `color-mix(in srgb, var(--color-surface-sunken) 50%, transparent)` |
| `.river-groove` | `oklch(0.15 0.01 240)` | `var(--color-surface)` |

### Legacy Gradient Flattening (index.css)

| Location | Before | After |
|---|---|---|
| `.stat-card-surface` | `linear-gradient(135deg, oklch(0.175 0.028 250), oklch(0.15 0.022 250))` | `var(--color-surface-raised)` |
| `.card-surface` | `linear-gradient(180deg, oklch(0.168 0.026 250), oklch(0.148 0.023 250))` | `var(--color-surface)` |

### Inline Style Replacements (TSX)

| File | Before | After |
|---|---|---|
| RangeSlider.tsx (context menu bg) | `oklch(0.15 0.01 240)` | `var(--color-surface)` |
| RangeSlider.tsx (context menu border) | `oklch(0.3 0.01 240)` | `var(--color-border-strong)` |
| RangeSlider.tsx (context menu shadow) | `oklch(0 0 0 / 0.5)` | `var(--shadow-lg)` |
| RangeSlider.tsx (track bg) | `oklch(0.13 0.01 240 / 0.5)` | `color-mix(in srgb, var(--color-surface-sunken) 50%, transparent)` |
| RangeSlider.tsx (`AMBER_GLOW` constant) | `oklch(0.750 0.185 60 / 0.28)` | `color-mix(in srgb, var(--color-warning) 28%, transparent)` |
| UploadPage.tsx (drag bg) | `oklch(0.750 0.180 195 / 0.06)` | `color-mix(in srgb, var(--color-interactive) 6%, transparent)` |
| UploadPage.tsx (icon bg) | `oklch(0.750 0.180 195 / 0.12)` | `color-mix(in srgb, var(--color-interactive) 12%, transparent)` |
| QueryWorkbench.tsx (drawer border) | `oklch(1 0 0 / 0.10)` | `color-mix(in srgb, white 10%, transparent)` |
| DevRangePage.tsx (filter text) | `oklch(0.750 0.150 60)` | `var(--color-warning)` |

### Dead Code Removed

- `CYAN_GLOW` constant in RangeSlider.tsx — unused, deleted

### Intentionally Kept Raw (Not Token Material)

| Category | What | Why |
|---|---|---|
| Button gradients | `oklch(0.79 0.18 195)` → `oklch(0.72 0.18 195)` (3 states) | Intentional depth flourish, straddles --color-interactive |
| River fill gradient | `oklch(0.55 0.16 195)` → `oklch(0.80 0.14 195)` | Data visualization — dark teal to pale cyan |
| Login background | `oklch(0.14 0.04 195)` | One-off radial gradient center |
| Frosted glass | `oklch(0 0 0 / 0.4–0.6)`, `oklch(1 0 0 / 0.05–0.15)` | Structural materials (vault-door, canopy, sidebar, scrollbar) |
| Canvas constants | `CANVAS_CYAN`, `CANVAS_AMBER` | Canvas `fillStyle` — can't use CSS vars |
| Hash colors | `oklch(0.20 0.05 ${hue})`, `oklch(0.75 0.18 ${hue})` | Runtime-computed dynamic hue |
| Heat map | `oklch(0.750 0.180 195 / ${dynamic})` | Runtime-computed dynamic opacity |
| Treemap texture | `oklch(0.12 0 0 / 0.5)` | Decorative stripe pattern |
| Range thumb fallback | `oklch(0.65 0.015 250 / 0.25)` inside `var()` | CSS fallback value |

---

---

## Pass 3: Neutral Ramp & Frosted Glass Tokens

### Neutral Ramp

Created a 13-stop neutral ramp in OKLCH with blue-violet undertone (hue 250), matching E2P's structural vocabulary. Surface, text, border, and control aliases now reference the ramp instead of defining raw OKLCH values.

| Ramp Stop | OKLCH Value | Dark Mode Alias(es) |
|---|---|---|
| `--neutral-50` | `oklch(0.97 0.005 250)` | (light mode — future) |
| `--neutral-100` | `oklch(0.93 0.008 250)` | `--color-text` |
| `--neutral-150` | `oklch(0.91 0.010 250)` | (light mode — future) |
| `--neutral-200` | `oklch(0.87 0.013 250)` | (light mode — future) |
| `--neutral-300` | `oklch(0.80 0.017 250)` | (light mode — future) |
| `--neutral-400` | `oklch(0.65 0.020 250)` | `--color-text-muted` |
| `--neutral-500` | `oklch(0.55 0.026 250)` | `--color-control` |
| `--neutral-600` | `oklch(0.44 0.024 250)` | `--color-text-faint` |
| `--neutral-700` | `oklch(0.26 0.032 250)` | `--color-surface-elevated`, `--color-border`, `--color-selection` |
| `--neutral-800` | `oklch(0.205 0.028 250)` | `--color-surface-raised` |
| `--neutral-900` | `oklch(0.15 0.024 250)` | `--color-surface` |
| `--neutral-950` | `oklch(0.10 0.020 250)` | `--color-surface-sunken`, `--color-text-inverse` |
| `--white` | `#fff` | (light mode — future) |

### Ramp Mapping Rationale

Dark end anchored at GenomeHub's existing values (user-specified):
- neutral-950 = former `--color-void` (L=0.10)
- neutral-900 = former `--color-base` (L=0.15)
- neutral-800 = former `--color-raised` (L=0.205)
- neutral-700 = former `--color-elevated` (L=0.26)

Light end extended to complete the scale for future light-mode support.

### Chroma Adjustments from Ramp Snapping

| Token | Before (C) | After (C) | Delta | Perceptible? |
|---|---|---|---|---|
| `--color-text` | 0.008 | 0.008 | 0 | No — exact match |
| `--color-text-muted` | 0.015 | 0.020 | +0.005 | Barely — slight blue lift |
| `--color-text-faint` | 0.012 | 0.024 | +0.012 | Subtle — at L=0.44, low absolute chroma |
| `--color-border` | 0.020 | 0.032 | +0.012 | Subtle — borders at L=0.26 are very dark |

### Frosted Glass Tokens

| Token | Value | Replaces |
|---|---|---|
| `--color-surface-frosted` | `oklch(0 0 0 / 0.4)` | `.vault-door` bg, `.sidebar-surface` bg |
| `--color-border-frosted` | `oklch(1 0 0 / 0.10)` | `.vault-door` border, `.glass-canopy` border, `.sigil` border, scrollbar, progress stripe |

### New Tokens Added

| Token | Value | Source |
|---|---|---|
| `--color-control` | `var(--neutral-500)` | E2P vocabulary — inactive controls, slider tracks |
| `--white` | `#fff` | E2P vocabulary — light mode base |

### GenomeHub Extensions (not yet in E2P)

| Token | Value | Notes |
|---|---|---|
| `--color-surface-elevated` | `var(--neutral-700)` | 4th surface tier |
| `--color-text-faint` | `var(--neutral-600)` | 3rd text tier |
| `--color-border-strong` | `oklch(0.34 0.024 250)` | Between neutral-600 and -700, no ramp stop |
| `--color-surface-frosted` | `oklch(0 0 0 / 0.4)` | Translucent overlay |
| `--color-border-frosted` | `oklch(1 0 0 / 0.10)` | Frosted glass edge |

---

## Verification

- `npm run build -w packages/client` — succeeds (786 modules, 0 errors)
- Built CSS contains new token names, zero old token names
- No TypeScript type errors

# CUBE CSS Color Token Audit — GenomeHub → E2P Mapping

**Date:** 2026-03-14
**Scope:** `packages/client/src/` — all CSS, TSX, TS files
**Goal:** Map every raw color value to E2P's intent-alias vocabulary

---

## Executive Summary

GenomeHub's color system is **well-organized but differently shaped** than E2P's.

- **Single source of truth:** `index.css` `@theme` block (lines 100–272), using Tailwind 4's `@theme` at-rule
- **Color model:** OKLCH throughout (perceptually uniform) — no RGB/HSL in the design system
- **Dark-only:** No light mode, no theme toggle, no `prefers-color-scheme` queries
- **~30 design tokens** covering surfaces, text, accents, borders, glows, shadows
- **~14 hex colors** for third-party brand icons and game-class pips (not part of design system)
- **~13 inline OKLCH values** in TSX files that need extraction to CSS classes
- **1 dynamic color function** (`hashColor()`) that generates OKLCH pairs from string labels

### Highest-Value Migrations (Most Frequently Referenced)

| GenomeHub Token | Usage Count | Proposed E2P Token |
|---|---|---|
| `--color-cyan` | ~50+ refs (CSS + Tailwind utilities) | `--color-interactive` / `--color-accent` |
| `--color-base` | ~30+ refs | `--color-surface` |
| `--color-fg` | ~25+ refs | `--color-text` |
| `--color-fg-2` | ~20+ refs | `--color-text-muted` |
| `--color-line` | ~15+ refs | `--color-border` |
| `--color-raised` | ~15+ refs | `--color-surface-raised` |
| `--color-void` | ~10+ refs | `--color-surface-sunken` |
| `--color-red` | ~10+ refs | `--color-danger` |

---

## 1. Dark Mode Strategy

### GenomeHub (Current)
- **Dark-only.** All OKLCH values are authored for a dark palette (L values: 0.1–0.26 for surfaces, 0.44–0.93 for text).
- No `@media (prefers-color-scheme: ...)` queries anywhere.
- No `[data-theme]` attributes or `.dark` class toggles.
- No light-mode fallbacks.

### E2P (Target)
- Uses `[data-theme="dark"]` attribute for theme switching.

### Migration Impact
GenomeHub will need to adopt `[data-theme]` scoping even if it ships dark-only initially. The current `@theme` values become the `[data-theme="dark"]` layer; a `[data-theme="light"]` layer can be added later. This is the biggest structural change.

---

## 2. Token Mapping Tables

### 2.1 Surfaces

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 124 | `--color-void: oklch(0.1 0.02 250)` | Deepest background (body, login bg) | `--color-surface-sunken` | |
| index.css | 126 | `--color-base: oklch(0.15 0.024 250)` | Primary app background | `--color-surface` | |
| index.css | 127 | `--color-raised: oklch(0.205 0.028 250)` | Cards, elevated panels, bubble-other | `--color-surface-raised` | |
| index.css | 128 | `--color-elevated: oklch(0.26 0.032 250)` | Highest elevation (dropdown, skeleton shimmer) | **NEW: `--color-surface-elevated`** | E2P has 3 tiers; GenomeHub needs 4 |
| index.css | 125 | `--color-row-stripe: var(--color-base)` | Alternating table row bg | `--color-surface` | Alias; resolves to base |
| index.css | 722 | `.vault-door: oklch(0 0 0 / 0.4)` | Dark frosted overlay | `--color-surface-frosted` | |
| index.css | 737 | `.glass-canopy: oklch(from void l c h / 0.72)` | Sticky header panel | `--color-surface-frosted` | Shares intent, different opacity |
| index.css | 747 | `.sidebar-surface: oklch(0 0 0 / 0.4)` | Sidebar background | `--color-surface-frosted` | Same as vault-door |
| index.css | 682 | `.login-bg: radial-gradient(... oklch(0.14 0.04 195) ... void)` | Login page background gradient | Composite — uses `--color-surface-sunken` + accent | |
| index.css | 874 | `.stat-card-surface: gradient 0.175→0.15 hue 250` | Dashboard stat card | `--color-surface-raised` | Gradient; may flatten |
| index.css | 884 | `.card-surface: gradient 0.168→0.148 hue 250` | Generic card surface | `--color-surface-raised` | Gradient; may flatten |
| RangeSlider.tsx | 792 | `oklch(0.13 0.01 240 / 0.5)` | Range track background (inline) | `--color-surface-sunken` | Inline; needs CSS class |
| RangeSlider.tsx | 967 | `oklch(0.15 0.01 240)` | Context menu background (inline) | `--color-surface` | Inline; needs CSS class |
| index.css | 774 | `.river-groove: oklch(0.15 0.01 240)` | RiverGauge track background | `--color-surface-sunken` | |
| index.css | 811 | `.range-track: oklch(0.13 0.01 240 / 0.5)` | Range slider track | `--color-surface-sunken` | |

### 2.2 Text

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 152 | `--color-fg: oklch(0.93 0.008 250)` | Primary body text | `--color-text` | |
| index.css | 153 | `--color-fg-2: oklch(0.65 0.015 250)` | Secondary text, labels | `--color-text-muted` | |
| index.css | 154 | `--color-fg-3: oklch(0.44 0.012 250)` | Tertiary text, ghost labels, placeholders | **NEW: `--color-text-faint`** | E2P has 2 text tiers; GenomeHub needs 3 |

### 2.3 Borders

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 158 | `--color-line: oklch(0.26 0.02 250)` | Standard borders | `--color-border` | |
| index.css | 159 | `--color-line-2: oklch(0.34 0.024 250)` | Secondary/heavier borders | **NEW: `--color-border-strong`** | |
| index.css | 723,740,748,824 | `oklch(1 0 0 / 0.05–0.10)` | Frosted glass borders (vault-door, canopy, sidebar, sigil) | `--color-border-frosted` | 4 occurrences at varying opacity |
| RangeSlider.tsx | 968 | `oklch(0.3 0.01 240)` | Context menu border (inline) | `--color-border` | Inline; needs CSS class |
| QueryWorkbench.tsx | 1581 | `oklch(1 0 0 / 0.10)` | Drawer border (inline) | `--color-border-frosted` | Inline; needs CSS class |

### 2.4 Interactive (Cyan)

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 132 | `--color-cyan: oklch(0.75 0.18 195)` | Buttons, links, active controls, headings | `--color-interactive` | Also serves as accent — see §3 |
| index.css | 133 | `--color-cyan-hover: oklch(0.8 0.18 195)` | Hover state | `--color-interactive-hover` | |
| index.css | 134 | `--color-cyan-dim: oklch(0.54 0.12 195)` | Muted interactive, ghost labels | **NEW: `--color-interactive-dim`** | |
| index.css | 135 | `--color-cyan-wash: oklch(0.22 0.04 195)` | Hover backgrounds, breathing effects | **NEW: `--color-interactive-wash`** | |

### 2.5 Accent

GenomeHub's cyan serves **double duty** as both interactive and accent. E2P separates these. During migration, `--color-accent` can alias `--color-interactive` initially.

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 132 | `--color-cyan` | Brand accent, headings | `--color-accent` | Same value as interactive |
| index.css | 134 | `--color-cyan-dim` | Subdued accent | `--color-accent-dim` | |

### 2.6 Secondary Accent (Violet) — NEW for E2P

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 146 | `--color-violet: oklch(0.62 0.15 280)` | Secondary status, bot indicator | **NEW: `--color-secondary`** | Not in E2P vocabulary |
| index.css | 147 | `--color-violet-dim: oklch(0.44 0.1 280)` | Dimmed secondary | **NEW: `--color-secondary-dim`** | |
| index.css | 148 | `--color-violet-wash: oklch(0.2 0.04 280)` | Secondary wash background | **NEW: `--color-secondary-wash`** | |

### 2.7 Status

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 171 | `--color-red: oklch(0.65 0.2 25)` | Error text, danger buttons | `--color-danger` | |
| index.css | 172 | `--color-red-dim: oklch(0.35 0.1 25)` | Dimmed error borders | **Map to:** `--color-danger-border` | |
| index.css | 173 | `--color-red-wash: oklch(0.2 0.04 25)` | Error background | `--color-danger-subtle` | |
| index.css | 177 | `--color-green: oklch(0.64 0.17 145)` | Success indicator | `--color-success` | |
| index.css | 178 | `--color-yellow: oklch(0.75 0.16 85)` | Caution/info indicator | `--color-warning` | Different from amber |
| index.css | 139 | `--color-amber: oklch(0.75 0.185 60)` | Out-of-bounds warning, active warning | `--color-warning` | **Conflict:** amber vs yellow |
| index.css | 140 | `--color-amber-hover: oklch(0.8 0.185 60)` | Warning hover state | **NEW: `--color-warning-hover`** | Not in E2P |
| index.css | 141 | `--color-amber-dim: oklch(0.54 0.12 60)` | Dimmed warning | **Map to:** `--color-warning-border` | |
| index.css | 142 | `--color-amber-wash: oklch(0.22 0.04 60)` | Warning background | `--color-warning-subtle` | |

**Note — Amber vs Yellow:** GenomeHub has two warning hues: amber (hue 60, used for OOB/active warnings in range sliders) and yellow (hue 85, used as a badge color). These may need to collapse into a single `--color-warning` or be distinguished as `--color-warning` vs `--color-caution`.

### 2.8 Focus

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 167 | `--glow-focus: ... oklch(0.75 0.18 195 / 0.5) ...` | Focus ring (2px solid + 16px glow) | `--color-ring` | Composite shadow; the color component maps to ring |

### 2.9 Glows & Shadows

E2P does not have glow/shadow tokens. These are candidates for new shared tokens.

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 163 | `--glow-cyan` | Cyan glow around active elements | **NEW: `--glow-interactive`** | |
| index.css | 164 | `--glow-cyan-sm` | Small cyan glow | **NEW: `--glow-interactive-sm`** | |
| index.css | 165 | `--glow-violet` | Violet glow | **NEW: `--glow-secondary`** | |
| index.css | 166 | `--glow-violet-sm` | Small violet glow | **NEW: `--glow-secondary-sm`** | |
| index.css | 229 | `--shadow-sm` | Small elevation shadow | **NEW: `--shadow-sm`** | |
| index.css | 230 | `--shadow-md` | Medium elevation shadow | **NEW: `--shadow-md`** | |
| index.css | 231 | `--shadow-lg` | Large elevation shadow | **NEW: `--shadow-lg`** | |

### 2.10 Scrollbar

| File | Line | Current Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 329 | `oklch(1 0 0 / 0.08)` | Scrollbar thumb | **NEW: `--color-scrollbar`** | |
| index.css | 345 | `oklch(1 0 0 / 0.15)` | Scrollbar thumb hover | **NEW: `--color-scrollbar-hover`** | |

### 2.11 Selection

| File | Line | Current Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| — | — | (not explicitly defined) | `::selection` not styled | `--color-selection` | Gap — needs to be added |

### 2.12 Controls

| File | Line | Current Token / Value | Used For | Proposed E2P Token | Notes |
|---|---|---|---|---|---|
| index.css | 410 | `--range-thumb-color: var(--color-fg-2)` | Range slider thumb | `--color-control` | |
| index.css | 423 | `oklch(0.65 0.015 250 / 0.25)` | Range thumb glow | Uses `--color-ring` | |

---

## 3. Inline Styles in TSX That Need CSS Classes

These are raw color values in JSX `style={{}}` props or JS constants used for inline styling/canvas drawing.

| File | Line | Current Value | Used For | Action |
|---|---|---|---|---|
| RangeSlider.tsx | 19 | `oklch(0.75 0.18 195)` | Canvas histogram bar fill | Extract to CSS variable or keep (canvas) |
| RangeSlider.tsx | 20 | `oklch(0.75 0.185 60)` | Canvas void indicator fill | Extract to CSS variable or keep (canvas) |
| RangeSlider.tsx | 256 | `oklch(0.750 0.185 60 / 0.28)` | Amber glow box-shadow | Move to CSS class |
| RangeSlider.tsx | 258 | `oklch(0.750 0.180 195 / 0.25)` | Cyan glow box-shadow | Move to CSS class |
| RangeSlider.tsx | 792 | `oklch(0.13 0.01 240 / 0.5)` | Track background | Move to CSS class |
| RangeSlider.tsx | 967–969 | `oklch(0.15 0.01 240)`, `oklch(0.3 0.01 240)`, `oklch(0 0 0 / 0.5)` | Context menu bg, border, shadow | Move to CSS class |
| QueryWorkbench.tsx | 66 | `oklch(0.750 0.180 195 / ${dynamic})` | Heat-map cell background | Keep (dynamic opacity) |
| QueryWorkbench.tsx | 1581 | `oklch(1 0 0 / 0.10)` | Drawer border | Move to CSS class |
| UploadPage.tsx | 44 | `oklch(0.750 0.180 195 / 0.06)` | Drop zone drag highlight | Move to CSS class |
| UploadPage.tsx | 56 | `oklch(0.750 0.180 195 / 0.12)` | Drop zone icon background | Move to CSS class |
| DevRangePage.tsx | 594 | `oklch(0.750 0.150 60)` | Filter indicator text (amber) | Move to CSS class |

**Canvas colors** (RangeSlider lines 19–20) can reference CSS variables via `getComputedStyle()`, or remain as JS constants that mirror token values. Either approach is valid; the key is that their values stay in sync with the token layer.

---

## 4. Third-Party Brand Colors (Exempt from Token System)

These are externally-defined brand colors. They should NOT be mapped to intent tokens — they are fixed by the brands they represent.

| File | Line | Value | Brand |
|---|---|---|---|
| ServiceIcon.tsx | 3 | `#2684FF` | Jira |
| ServiceIcon.tsx | 7 | `#1868DB` | Confluence |
| ServiceIcon.tsx | 11 | `#E01E5A` | Slack |
| ServiceIcon.tsx | 15 | `#4285F4` | Google Docs |
| ServiceIcon.tsx | 19 | `#0F9D58` | Google Sheets |
| ServiceIcon.tsx | 23 | `#FBBC04` | Google Drive |
| ServiceIcon.tsx | 27 | `#8B949E` | GitHub |
| ServiceIcon.tsx | 31 | `#AFAFAF` | Notion |
| ServiceIcon.tsx | 35 | `#2CB5E0` | Benchling |
| ServiceIcon.tsx | 39 | `#336699` | NCBI |
| ServiceIcon.tsx | 43 | `#5C8727` | EBI |
| ServiceIcon.tsx | 47 | `#5B57D1` | Protocols.io |
| LoginPage.tsx | 13–25 | `#4285F4, #34A853, #FBBC05, #EA4335` | Google OAuth logo |

**Recommendation:** Consolidate into a `--brand-{service}` namespace in the token layer for discoverability, but leave values fixed.

---

## 5. Game-Class Pip Colors (Domain-Specific)

These are GenomeHub-specific categorical colors for technique/class indicators. They use hex values and don't correspond to any E2P token.

| Class | Value | Approx. Hue |
|---|---|---|
| cleric | `#f0c040` | 42° (gold) |
| warrior | `#d4ad80` | 30° (bronze) |
| wizard | `#69ccf0` | 199° (sky blue) |
| magician | `#40b8b0` | 174° (teal) |
| enchanter | `#b490d0` | 270° (lavender) |
| necromancer | `#bf50e0` | 283° (magenta) |
| shadow-knight | `#9545d0` | 274° (purple) |
| rogue | `#d4e040` | 68° (lime) |
| ranger | `#abd473` | 94° (moss) |
| druid | `#ff7d0a` | 27° (orange) |
| monk | `#00ff96` | 155° (mint) |
| bard | `#f03070` | 343° (hot pink) |
| paladin | `#f58cba` | 333° (rose) |
| shaman | `#2890f0` | 213° (blue) |

**Recommendation:** Migrate to OKLCH for consistency with the rest of the palette. These are categorical colors — they belong in a `--color-category-{class}` namespace or remain as a separate data-visualization palette outside the CUBE token layer.

---

## 6. Dynamic Color System (`hashColor()`)

`packages/client/src/lib/colors.ts` generates deterministic OKLCH pairs from string labels:

```
bg:    oklch(0.20  0.05  ${hue})   — dark tint for pill backgrounds
color: oklch(0.75  0.18  ${hue})   — bright text on the tint
```

These use the same L/C values as the design system (0.20 ≈ raised surface, 0.75 ≈ cyan accent brightness). This is intentional — hash colors are visually harmonious with the token palette.

**Migration impact:** The L and C values should reference token primitives so they scale with theme changes. Possible approach: `oklch(var(--L-wash) var(--C-wash) ${hue})`.

---

## 7. New Tokens Required (Not in E2P)

These tokens are needed by GenomeHub but absent from E2P's current vocabulary.

### Must-have (used pervasively)

| Proposed Token | GenomeHub Source | Rationale |
|---|---|---|
| `--color-surface-elevated` | `--color-elevated` | 4th surface tier (GenomeHub has void/base/raised/elevated) |
| `--color-text-faint` | `--color-fg-3` | 3rd text tier for placeholders, ghost labels |
| `--color-interactive-dim` | `--color-cyan-dim` | Muted interactive for inactive controls |
| `--color-interactive-wash` | `--color-cyan-wash` | Tinted backgrounds for hover/breathing effects |
| `--color-border-strong` | `--color-line-2` | Heavier border for emphasis |

### Should-have (used in multiple components)

| Proposed Token | GenomeHub Source | Rationale |
|---|---|---|
| `--color-secondary` | `--color-violet` | Secondary accent hue (bot indicators, status) |
| `--color-secondary-dim` | `--color-violet-dim` | Dimmed secondary |
| `--color-secondary-wash` | `--color-violet-wash` | Secondary background wash |
| `--color-warning-hover` | `--color-amber-hover` | Warning hover state |
| `--glow-interactive` | `--glow-cyan` | Glow effect for interactive elements |
| `--shadow-sm/md/lg` | `--shadow-sm/md/lg` | Elevation shadows |

### Nice-to-have (specialized)

| Proposed Token | GenomeHub Source | Rationale |
|---|---|---|
| `--color-scrollbar` | `oklch(1 0 0 / 0.08)` | Scrollbar styling |
| `--color-scrollbar-hover` | `oklch(1 0 0 / 0.15)` | Scrollbar hover |

---

## 8. Rename Map (Quick Reference)

Final cheat sheet for the mechanical rename during migration.

| GenomeHub Current | → E2P Token |
|---|---|
| `--color-void` | `--color-surface-sunken` |
| `--color-base` | `--color-surface` |
| `--color-raised` | `--color-surface-raised` |
| `--color-elevated` | `--color-surface-elevated` ★ |
| `--color-fg` | `--color-text` |
| `--color-fg-2` | `--color-text-muted` |
| `--color-fg-3` | `--color-text-faint` ★ |
| `--color-line` | `--color-border` |
| `--color-line-2` | `--color-border-strong` ★ |
| `--color-cyan` | `--color-interactive` |
| `--color-cyan-hover` | `--color-interactive-hover` |
| `--color-cyan-dim` | `--color-interactive-dim` ★ |
| `--color-cyan-wash` | `--color-interactive-wash` ★ |
| `--color-violet` | `--color-secondary` ★ |
| `--color-violet-dim` | `--color-secondary-dim` ★ |
| `--color-violet-wash` | `--color-secondary-wash` ★ |
| `--color-amber` | `--color-warning` |
| `--color-amber-hover` | `--color-warning-hover` ★ |
| `--color-amber-dim` | `--color-warning-border` |
| `--color-amber-wash` | `--color-warning-subtle` |
| `--color-red` | `--color-danger` |
| `--color-red-dim` | `--color-danger-border` |
| `--color-red-wash` | `--color-danger-subtle` |
| `--color-green` | `--color-success` |
| `--color-yellow` | `--color-warning` (or `--color-caution` ★) |
| `--color-row-stripe` | `--color-surface` (alias) |
| `--glow-focus` | `--color-ring` (color component) |

★ = new token that E2P doesn't have yet

---

## 9. Migration Risks & Open Questions

1. **Cyan = Interactive AND Accent.** GenomeHub uses one hue for both buttons and brand identity. E2P separates `--color-interactive` and `--color-accent`. Should they stay unified or split? (Recommend: alias `--color-accent: var(--color-interactive)` initially.)

2. **Amber vs Yellow.** Two distinct warning hues. Amber (hue 60) is the primary warning. Yellow (hue 85) is used only in badges. Should yellow become `--color-caution` or collapse into `--color-warning`?

3. **4-tier surfaces.** GenomeHub's void/base/raised/elevated is one more tier than E2P's sunken/default/raised. The `--color-surface-elevated` token needs to be added to the shared vocabulary.

4. **3-tier text.** GenomeHub's fg/fg-2/fg-3 is one more tier than E2P's text/text-muted. The `--color-text-faint` token needs to be added.

5. **Glow system.** GenomeHub has a developed glow/shadow vocabulary (`--glow-cyan`, `--glow-violet`, `--glow-focus`, `--shadow-sm/md/lg`). E2P doesn't have these yet. They should be added as shared tokens.

6. **`color-mix()` usage.** GenomeHub uses `color-mix(in srgb, ...)` for dynamic blending (treemap cells, chat bubbles). These compositions reference tokens but produce new colors at runtime. They don't need tokens — they stay as compositions.

7. **Canvas colors.** `RangeSlider.tsx` paints to `<canvas>` using JS string constants that duplicate token values. These should read from `getComputedStyle()` or be kept in sync manually.

8. **`oklch(from ...)` relative syntax.** `.glass-canopy` uses `oklch(from var(--color-void) l c h / 0.72)`. This is a CSS relative color function — it composes from a token, which is good. No migration needed for these.

9. **No `::selection` styling.** E2P has `--color-selection`; GenomeHub doesn't style `::selection`. Add during migration.

10. **No `--color-text-inverse`.** GenomeHub doesn't have a token for text on interactive/dark backgrounds. The `.sigil.active` class uses `var(--color-void)` for this. Should be aliased to `--color-text-inverse`.

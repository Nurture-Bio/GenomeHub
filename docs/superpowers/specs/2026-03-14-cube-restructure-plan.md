# CUBE Restructure — File Assignment Plan

## Rule Categorization (index.css → 6 files)

### reset.css
- Standard browser reset (box-sizing, margin, padding, media blocks, form inherit, link/list reset)
- Tailwind's preflight handles most of this — reset.css provides fallback if Tailwind is removed
- NO var() references, NO tokens

### tokens.css
- @font-face declarations (lines 1-96) — raw font values
- @import 'tailwindcss' — must come first
- @theme block (lines 100-297) — all design tokens + neutral ramp
- :root layout constants (lines 299-303)
- Element-level styles from @layer base (lines 307-375):
  - body: font, bg, color, height, display, flex, font-size
  - #root: display, flex, height
  - Global motion defaults (button/a/input transitions)
  - :focus-visible (outline + glow)
  - button:active scale
  - Scrollbar styling (all pseudo-elements)
- New pip color tokens (extract hex from .pip-* to --color-pip-*)
- New component-specific tokens:
  - --range-thumb-size: 14px
  - --scrollbar-size: 12px
  - --nav-indicator-width: 3px
  - --blur-glass: 12px
  - --letter-spacing-sigil: 0.15em

### compositions.css (GEOMETRY ONLY — no color, background, border-color, font-*, text-*)
- .row-hover: position: relative, isolation: isolate
- .row-hover::before/td::before: position, inset, z-index, pointer-events (content: '')
- .treemap-cell: position: absolute, display: flex, flex-direction, align-items, justify-content, gap, padding, overflow
- .treemap-texture::before: position: absolute, inset: 0, pointer-events: none, z-index
- .field-tooltip: position: relative
- .field-tooltip::after: position: absolute, bottom, left, z-index, pointer-events: none, white-space: nowrap
- .nav-active-indicator: position: relative
- .nav-active-indicator::before: position, left, top, bottom, width, border-radius (geometry of indicator bar)
- .equipment-grid: display: grid, gap, grid-template-columns, grid-template-areas + mobile @media
- .equipment-slot: grid-area, display: flex, flex-direction, align-items, gap, padding
- .collapse-container: display: grid, grid-template-rows
- .collapse-container > .collapse-inner: overflow: hidden
- .format-icon: display: flex, align-items, justify-content, width, height
- .vault-door: contain: layout style paint
- .glass-canopy: contain: layout style paint
- .sidebar-surface: contain: layout style paint
- .river-groove: overflow: hidden

### blocks.css (VISUAL TREATMENT — bg, color, border, font, shadow, transition, cursor, animation)
- .vault-door: background, border, border-radius, cursor, transition
- .vault-door:hover: background, will-change
- .glass-canopy: background, backdrop-filter, border, border-radius
- .sidebar-surface: background, border-right
- .river-*: all river gauge visual styles + @keyframes riverImpactFlash, distPlotBreath
- .range-track: background, border-radius
- .range-thumb (all pseudo-elements): appearance, width, height, border-radius, background, border, shadow, cursor, transition, hover states
- .sigil + :hover + :active + .active + .active:hover: all visual treatment
- .sigil-sm: padding, letter-spacing, text-transform (modifier — could be utility, but has multiple properties)
- .treemap-cell: background, border, cursor, transition (visual split from composition)
- .treemap-cell:hover, .active, .dimmed: visual states
- .treemap-label: font, color, text-overflow
- .treemap-count: font, color
- .treemap-texture::before: opacity, background (visual split)
- .input-focus-glow:focus: border-color, box-shadow
- .btn-primary + :hover + :active: gradient background, color, font-weight, shadow
- .logo-glow: filter
- .login-bg: background gradient
- .ghost + .awake: opacity, pointer-events, transition
- .stat-card-surface: background, border, border-radius
- .surface-header: background gradient
- .card-surface: background
- .hash-chip: font, background, color, transition + :hover/:active filter
- .hash-filter-btn: font, background, color, border, transition + :hover/:active
- .readout-seg.status-*: background colors
- .readout-dot.status-*: background colors
- .chat-bg: background
- .bubble-self, .bubble-other: background, border
- .amber-glow: box-shadow
- .message-command::before: content, color
- .loading::after: content, animation
- .field-tooltip::after: padding, background, border, border-radius, font, color, shadow, opacity, transition
- .field-tooltip:hover::after: opacity
- .equipment-slot: border, border-radius, transition (visual split)
- .equipment-slot.filled: border-color, background
- .equipment-slot.filled:hover: border-color, background
- .equipment-slot-label: font, color
- .stagger-item: animation
- .progress-stripe: background-image, animation + @keyframes progress-stripe
- .format-icon: border-radius, font-size, letter-spacing (visual split)
- .skeleton: border-radius, background, animation + @keyframes shimmer, fadeOpacity
- .animate-fade-in: animation
- .pip-*: background: var(--color-pip-*)
- .river-readout + variants: font, color, transition, letter-spacing
- .river-total + .stalled: font, color
- @keyframes: fadeIn, slideInLeft, pulse, stepperPing, stepperReveal, stepperFlourish, stepperFlourishPing, stepperConnFlourish, flourishLabel, pageEnter, fadeUp, fadeOpacity, distPlotBreath, shimmer, progress-stripe, riverImpactFlash
- .stepper-*: animation
- @media prefers-reduced-motion: reduce
- @media (width < 48rem) treemap overrides
- Visual language comment block

### utilities.css (SINGLE PURPOSE — one job each)
- .pb-safe: padding-bottom: env(safe-area-inset-bottom)
- .pixelated: image-rendering: pixelated
- .tbl-cell: @apply py-1.5 pl-2.5 pr-3
- .tbl-cell-end: @apply py-1.5 pr-2.5
- .tbl-row: @apply px-2 py-1.5
- .range-low: z-index: 3
- .range-high: z-index: 4
- .range-low:active/focus: z-index: 5
- .range-high:active/focus: z-index: 5
- .skel-format-icon: width + height
- .skel-check: width + height
- .ghost + .awake: opacity + pointer-events (TWO props but single purpose: visibility toggle)

### exceptions.css (DATA-ATTRIBUTE state variations)
- .hash-filter-btn[data-active='true']: bg, color, border-color
- .collapse-container[data-expanded='true']: grid-template-rows: 1fr
- .collapse-chevron[data-expanded='true']: transform: rotate(90deg)

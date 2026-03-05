# Component Catalog — Design Document

**Date:** 2026-03-04
**Status:** Approved

## Goal

Build a public-facing component catalog using Storybook 8, deployed to GitHub Pages. Every UI primitive in `packages/client/src/ui/` gets a story file. CSS-only materials (sigil, glass-canopy, vault-door, etc.) get a dedicated documentation page.

## Architecture

### Framework

**Storybook 8** with `@storybook/react-vite`. Reuses the existing Vite config (Tailwind v4, LightningCSS, path aliases) with zero duplication.

### Location

Co-located inside `packages/client/`:

```
packages/client/
├── .storybook/
│   ├── main.ts          # framework, addons, story globs
│   ├── preview.ts       # global decorators, CSS import
│   └── preview-head.html  # font links (if needed)
├── src/ui/
│   ├── Button.tsx
│   ├── Button.stories.tsx   # co-located story
│   ├── Text.tsx
│   ├── Text.stories.tsx
│   ├── Materials.mdx        # CSS-only materials page
│   └── ...
```

### Addons

- `@storybook/addon-essentials` — Controls, Docs, Actions, Viewport
- `@storybook/addon-a11y` — Accessibility audit panel

### Global Decorator

All stories render on the app's dark void background:

```tsx
import '../src/index.css';

const preview = {
  decorators: [
    (Story) => (
      <div style={{ background: 'var(--color-void)', padding: '2rem', minHeight: '100vh' }}>
        <Story />
      </div>
    ),
  ],
};
```

## Story Inventory

### React Components (16 story files)

| Component | File | Variants | Notes |
|-----------|------|----------|-------|
| Button | `Button.stories.tsx` | 6 intents x 5 sizes, pending state | Grid layout |
| Text | `Text.stories.tsx` | 6 variants (body, dim, muted, mono, error, caption) | Side-by-side |
| Heading | `Text.stories.tsx` | 4 levels (display, title, heading, subheading) | Stacked, shows animate-fade-in |
| Input | `Input.stories.tsx` | 4 variants x 3 sizes | With placeholder |
| Card | `Card.stories.tsx` | elevated vs flat | Nested content |
| Badge | `Badge.stories.tsx` | 3 variants x 6 colors | Grid |
| InlineInput | `InlineInput.stories.tsx` | 2 font variants | Interactive border transition |
| ComboBox | `ComboBox.stories.tsx` | Default, with items, with selection | Mock data |
| ChipEditor | `ChipEditor.stories.tsx` | Empty, with chips, editing | Interactive |
| FilterChip | `FilterChip.stories.tsx` | Active, inactive, with count | |
| HashChip | `HashChip.stories.tsx` | Various hash colors | Deterministic color algorithm |
| HashChipPopover | `HashChipPopover.stories.tsx` | Open, closed | |
| Stepper | `Stepper.stories.tsx` | 1-5 steps, active indices, error/warning health, progress, flourish | Showpiece — all SVG animations |
| RiverGauge | `RiverGauge.stories.tsx` | tide vs waterfall, normal/pending/stalled, terminal dissolve | Second showpiece — both physics modes |
| EntityPicker | `EntityPicker.stories.tsx` | All 5 picker variants | Collection, Organism, FileType, Technique, Relation |

### CSS Materials Page (1 MDX file)

`Materials.mdx` — showcases CSS-only classes that aren't React components:

- **Surfaces:** `.glass-canopy`, `.vault-door`, `.sidebar-surface`
- **Controls:** `.sigil`, `.sigil.active`, `.sigil-sm`, `.ghost`, `.ghost.awake`
- **Tracks:** `.river-groove`, `.river-fill`, `.range-track`
- **Cyan Spectrum:** Four attenuation levels as color swatches
- **Animations:** `.animate-fade-in`, `.stepper-ping`, `.stepper-flourish`

## Deployment

### GitHub Actions

`.github/workflows/storybook.yml`:
- Triggers on push to `main`
- Runs `npm ci` → `npx storybook build -o storybook-static`
- Deploys via `actions/deploy-pages@v4`
- URL: `https://<org>.github.io/GenomeHub/`

### Package Scripts

```json
{
  "storybook": "storybook dev -p 6006",
  "build-storybook": "storybook build -o storybook-static"
}
```

### Gitignore

Add `storybook-static/` to `.gitignore`.

## Non-Goals

- Chromatic visual regression testing (future addition)
- Light theme variant (app is dark-only)
- Component unit tests via Storybook (use vitest separately if needed)

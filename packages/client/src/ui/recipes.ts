import { cva, type VariantProps } from 'class-variance-authority';

/*
 * CVA RECIPES — the component pattern layer.
 *
 * Axioms live in @theme (index.css).
 * Recipes compose tokens via Tailwind utilities.
 * Pages use only layout utilities + these recipes.
 *
 * With --spacing: 0.5rem (8px), numeric utilities map:
 *   0.5 → 4px, 1 → 8px, 1.5 → 12px, 2 → 16px,
 *   2.5 → 20px, 3 → 24px, 4 → 32px, 5 → 40px, 6 → 48px
 */

// ── BUTTON ──────────────────────────────────────────────

export const button = cva(
  'cursor-pointer font-sans transition-colors duration-fast inline-flex items-center justify-center shrink-0',
  {
    variants: {
      intent: {
        primary: 'bg-cyan text-void font-bold border-none hover:bg-cyan-hover',
        ghost: 'bg-transparent border border-line text-fg-3 hover:text-fg hover:border-fg-3',
        danger: 'bg-raised border border-red text-red hover:bg-line',
        success: 'bg-raised border border-green text-green hover:bg-line',
        component: 'bg-raised border border-line text-fg hover:bg-line',
        bare: 'bg-transparent border-none text-inherit',
      },
      size: {
        xs: 'text-body py-0.5 px-1 rounded-sm',
        sm: 'text-body py-0.5 px-1.5 rounded-sm min-h-6',
        md: 'text-body py-1 px-2 rounded-sm min-h-5.5',
        lg: 'text-body py-1 px-3 rounded-sm min-h-5.5',
        xl: 'text-body py-1.5 px-4 rounded-md font-bold min-h-5.5',
      },
      pending: {
        true: 'opacity-60 cursor-wait pointer-events-none',
        false: '',
      },
    },
    defaultVariants: {
      intent: 'primary',
      size: 'md',
      pending: false,
    },
  }
);

export type ButtonVariants = VariantProps<typeof button>;

// ── INPUT ───────────────────────────────────────────────

export const input = cva(
  'border border-line text-fg rounded-sm focus:outline-none focus:border-cyan',
  {
    variants: {
      variant: {
        default: 'bg-void font-sans placeholder:text-fg-3',
        surface: 'bg-raised font-sans placeholder:text-fg-3',
        transparent: 'bg-transparent font-sans placeholder:text-fg-3',
        mono: 'bg-void font-mono',
      },
      size: {
        sm: 'text-body py-0.5 px-1.5 min-h-6',
        md: 'text-body py-1 px-1.5 min-h-5.5',
        lg: 'text-body py-1 px-2 min-h-5.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export type InputVariants = VariantProps<typeof input>;

// ── CARD ────────────────────────────────────────────────

export const card = cva(
  'bg-base border border-line rounded-md overflow-hidden',
  {
    variants: {
      elevated: {
        true: 'shadow-md',
        false: '',
      },
    },
    defaultVariants: {
      elevated: false,
    },
  }
);

export type CardVariants = VariantProps<typeof card>;

// ── DROPDOWN ────────────────────────────────────────────

export const dropdown = cva(
  'absolute bg-base border border-line shadow-lg animate-fade-in overflow-y-auto z-dropdown',
  {
    variants: {
      position: {
        above: 'bottom-full left-0 right-0 mb-0.5 rounded-md',
        below: 'top-full left-0 right-0 mt-0.5 rounded-md',
        'below-right': 'top-full right-0 mt-0.5 rounded-md',
      },
    },
    defaultVariants: {
      position: 'above',
    },
  }
);

export type DropdownVariants = VariantProps<typeof dropdown>;

// ── DROPDOWN ITEM ───────────────────────────────────────

export const dropdownItem = cva(
  'cursor-pointer font-sans text-body px-2 py-1 border-b border-line last:border-b-0 transition-colors duration-fast',
  {
    variants: {
      selected: {
        true: 'bg-raised',
        false: 'hover:bg-raised',
      },
    },
    defaultVariants: {
      selected: false,
    },
  }
);

export type DropdownItemVariants = VariantProps<typeof dropdownItem>;

// ── TEXT — 5 variants ───────────────────────────────────

export const text = cva('', {
  variants: {
    variant: {
      body: 'text-fg font-sans text-body',
      dim: 'text-fg-2 font-sans text-body',
      muted: 'text-fg-3 font-sans text-body font-bold uppercase tracking-overline',
      mono: 'text-fg font-mono text-body tabular-nums',
      error: 'text-red font-sans text-body',
    },
  },
  defaultVariants: {
    variant: 'body',
  },
});

export type TextVariants = VariantProps<typeof text>;

// ── HEADING — 2 levels ──────────────────────────────────

export const heading = cva('font-semibold font-sans', {
  variants: {
    level: {
      heading: 'text-heading text-cyan',
      subheading: 'text-body text-fg',
    },
  },
  defaultVariants: {
    level: 'heading',
  },
});

export type HeadingVariants = VariantProps<typeof heading>;

// ── BADGE ───────────────────────────────────────────────

export const badge = cva('font-sans font-bold', {
  variants: {
    variant: {
      status: 'text-body uppercase tracking-overline px-1 py-px rounded-sm bg-raised',
      count: 'inline-flex items-center bg-raised text-body leading-none py-px px-1 font-semibold rounded-sm normal-case',
      filter: 'bg-base border border-line rounded-sm px-1 py-0.5 text-body font-semibold normal-case',
    },
    color: {
      accent: 'text-cyan',
      green: 'text-green',
      yellow: 'text-yellow',
      red: 'text-red',
      dim: 'text-fg-3',
      default: 'text-fg-3',
    },
  },
  defaultVariants: {
    variant: 'status',
    color: 'default',
  },
});

export type BadgeVariants = VariantProps<typeof badge>;

// ── NAV LINK ────────────────────────────────────────────

export const navLink = cva(
  'no-underline font-sans text-body font-semibold px-2.5 py-1.5 flex items-center tracking-wide transition-colors duration-fast',
  {
    variants: {
      active: {
        true: 'text-cyan',
        false: 'text-fg-2 hover:text-fg',
      },
    },
    defaultVariants: {
      active: false,
    },
  }
);

export type NavLinkVariants = VariantProps<typeof navLink>;

// ── STATUS DOT ──────────────────────────────────────────

export const statusDot = cva('rounded-full shrink-0', {
  variants: {
    status: {
      connected: 'bg-green',
      disconnected: 'bg-red',
    },
    size: {
      sm: 'size-0.5',
      md: 'size-1',
    },
  },
  defaultVariants: {
    status: 'connected',
    size: 'md',
  },
});

export type StatusDotVariants = VariantProps<typeof statusDot>;

// ── PROGRESS TRACK ──────────────────────────────────────

export const progressTrack = cva(
  'flex bg-raised gap-px overflow-hidden rounded-full h-1'
);

// ── MODAL OVERLAY ───────────────────────────────────────

export const modalOverlay = cva(
  'fixed inset-0 bg-black/75 z-modal flex items-center justify-center px-2'
);

// ── MODAL CARD ──────────────────────────────────────────

export const modalCard = cva(
  'bg-elevated border border-line rounded-lg shadow-lg p-3 w-full max-w-embed'
);

// ── RECONNECT BANNER ────────────────────────────────────

export const reconnectBanner = cva(
  'bg-red text-white text-center py-1 text-body font-bold uppercase tracking-wide animate-pulse-slow'
);

// ── EMBED CARD ──────────────────────────────────────────

export const embedCard = cva(
  'bg-base border-l-2 rounded-md py-1.5 px-2 max-w-embed',
  {
    variants: {
      color: {
        red: 'border-l-red',
        yellow: 'border-l-yellow',
        green: 'border-l-green',
      },
    },
    defaultVariants: {
      color: 'green',
    },
  }
);

export type EmbedCardVariants = VariantProps<typeof embedCard>;

// ── INLINE INPUT ───────────────────────────────────────

export const inlineInput = cva(
  'bg-transparent border-b border-transparent outline-none p-0 transition-colors duration-fast placeholder:text-fg-3 hover:border-line focus:border-cyan focus:cursor-text cursor-pointer',
  {
    variants: {
      font: {
        mono: 'font-mono text-body text-fg',
        body: 'font-sans text-body text-fg-2',
      },
    },
    defaultVariants: {
      font: 'body',
    },
  }
);

export type InlineInputVariants = VariantProps<typeof inlineInput>;

// ── CHIP ───────────────────────────────────────────────

export const chip = cva(
  'inline-flex items-center gap-px font-sans text-body px-1 py-px rounded-sm',
  {
    variants: {
      variant: {
        default: 'bg-raised text-fg-2',
        subtle: 'text-fg-3',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export type ChipVariants = VariantProps<typeof chip>;

// ── ICON ACTION ────────────────────────────────────────

export const iconAction = cva(
  'cursor-pointer bg-transparent border-none p-0 text-body transition-colors duration-fast',
  {
    variants: {
      color: {
        dim: 'text-fg-3 hover:text-fg',
        accent: 'text-cyan hover:text-fg',
        danger: 'text-fg-3 hover:text-red',
      },
      reveal: {
        true: 'opacity-0 group-hover:opacity-100 transition-opacity',
        false: '',
      },
    },
    defaultVariants: {
      color: 'dim',
      reveal: false,
    },
  }
);

export type IconActionVariants = VariantProps<typeof iconAction>;

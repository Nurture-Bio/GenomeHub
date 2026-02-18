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
  'cursor-pointer font-body transition-colors duration-fast inline-flex items-center justify-center shrink-0',
  {
    variants: {
      intent: {
        primary: 'bg-accent text-bg font-bold border-none hover:bg-accent-hover',
        ghost: 'bg-transparent border border-border text-text-dim hover:text-text hover:border-text-dim',
        danger: 'bg-surface-2 border border-red text-red hover:bg-border',
        success: 'bg-surface-2 border border-green text-green hover:bg-border',
        component: 'bg-surface-2 border border-border text-text hover:bg-border',
        bare: 'bg-transparent border-none text-inherit',
      },
      size: {
        xs: 'text-micro py-0.5 px-1 rounded-sm',
        sm: 'text-caption py-0.5 px-1.5 rounded-sm min-h-6',
        md: 'text-caption py-1 px-2 rounded-sm',
        lg: 'text-body py-1 px-3 rounded-sm',
        xl: 'text-body py-1.5 px-4 rounded-md font-bold',
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
  'border border-border text-text rounded-sm focus:outline-none focus:border-accent',
  {
    variants: {
      variant: {
        default: 'bg-bg font-body placeholder:text-text-dim',
        surface: 'bg-surface-2 font-body placeholder:text-text-dim',
        transparent: 'bg-transparent font-body placeholder:text-text-dim',
        mono: 'bg-bg font-mono',
      },
      size: {
        sm: 'text-caption py-0.5 px-1.5 min-h-6',
        md: 'text-caption py-1 px-1.5',
        lg: 'text-body py-1 px-2',
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
  'bg-surface border border-border rounded-md overflow-hidden',
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
  'absolute bg-surface border border-border shadow-lg animate-fade-in overflow-y-auto z-dropdown',
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
  'cursor-pointer font-body text-caption px-2 py-1 border-b border-border-subtle last:border-b-0 transition-colors duration-fast',
  {
    variants: {
      selected: {
        true: 'bg-surface-2',
        false: 'hover:bg-surface-2',
      },
    },
    defaultVariants: {
      selected: false,
    },
  }
);

export type DropdownItemVariants = VariantProps<typeof dropdownItem>;

// ── TEXT ─────────────────────────────────────────────────

export const text = cva('', {
  variants: {
    variant: {
      body: 'text-text font-body text-body',
      caption: 'text-text-dim font-body text-caption',
      secondary: 'text-text-secondary font-body text-body',
      overline: 'text-text-dim font-body text-micro font-bold uppercase tracking-overline',
      mono: 'text-text font-mono text-caption tabular-nums',
      label: 'text-text-dim font-body text-caption',
      error: 'text-red font-body text-caption',
      system: 'text-text-dim font-body text-caption italic',
      command: 'text-text-secondary font-mono text-caption message-command',
    },
  },
  defaultVariants: {
    variant: 'body',
  },
});

export type TextVariants = VariantProps<typeof text>;

// ── HEADING ─────────────────────────────────────────────

export const heading = cva('font-bold', {
  variants: {
    level: {
      hero: 'font-display text-hero text-accent',
      display: 'font-display text-display text-accent',
      heading: 'font-display text-heading text-accent',
      subheading: 'font-display text-subheading text-accent',
      section: 'font-body text-body text-text',
    },
  },
  defaultVariants: {
    level: 'heading',
  },
});

export type HeadingVariants = VariantProps<typeof heading>;

// ── BADGE ───────────────────────────────────────────────

export const badge = cva('font-body font-bold', {
  variants: {
    variant: {
      status: 'text-micro uppercase tracking-overline px-1 py-px rounded-sm bg-surface-2',
      count: 'inline-flex items-center bg-surface-2 text-micro leading-none py-px px-1 font-semibold rounded-sm normal-case',
      filter: 'bg-surface border border-border rounded-sm px-1 py-0.5 text-caption font-semibold normal-case',
    },
    color: {
      accent: 'text-accent',
      green: 'text-green',
      yellow: 'text-yellow',
      red: 'text-red',
      blue: 'text-blue',
      dim: 'text-text-dim',
      default: 'text-text-dim',
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
  'no-underline font-body text-caption font-semibold px-2.5 py-1.5 flex items-center tracking-wide transition-colors duration-fast',
  {
    variants: {
      active: {
        true: 'text-accent',
        false: 'text-text-secondary hover:text-text',
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
  'flex bg-surface-2 gap-px overflow-hidden rounded-full h-1'
);

// ── MODAL OVERLAY ───────────────────────────────────────

export const modalOverlay = cva(
  'fixed inset-0 bg-black/75 z-modal flex items-center justify-center px-2'
);

// ── MODAL CARD ──────────────────────────────────────────

export const modalCard = cva(
  'bg-surface-3 border border-border rounded-lg shadow-lg p-3 w-full max-w-embed'
);

// ── RECONNECT BANNER ────────────────────────────────────

export const reconnectBanner = cva(
  'bg-red text-white text-center py-1 text-caption font-bold uppercase tracking-wide animate-pulse-slow'
);

// ── EMBED CARD ──────────────────────────────────────────

export const embedCard = cva(
  'bg-surface border-l-2 rounded-md py-1.5 px-2 max-w-embed',
  {
    variants: {
      color: {
        red: 'border-l-red',
        blue: 'border-l-blue',
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

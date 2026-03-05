# Component Catalog (Storybook) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a public-facing Storybook 8 component catalog for all 16 UI primitives + CSS material classes, deployed to GitHub Pages.

**Architecture:** Storybook 8 with `@storybook/react-vite` framework, co-located stories next to components in `packages/client/src/ui/`. Global decorator provides dark void background + `index.css` import. GitHub Actions deploys static build to GitHub Pages on push to main.

**Tech Stack:** Storybook 8, @storybook/react-vite, @storybook/addon-essentials, @storybook/addon-a11y, MSW (Mock Service Worker), GitHub Actions

---

### Task 1: Install Storybook and configure

**Files:**
- Modify: `packages/client/package.json` (scripts + devDependencies)
- Create: `packages/client/.storybook/main.ts`
- Create: `packages/client/.storybook/preview.ts`
- Modify: `.gitignore` (add storybook-static/)

**Step 1: Initialize Storybook**

Run from repo root:
```bash
cd packages/client && npx storybook@latest init --type react --builder vite --no-dev
```

This scaffolds `.storybook/` and adds deps. If it creates example stories, delete them.

**Step 2: Install a11y addon and MSW**

```bash
npm install -D @storybook/addon-a11y msw msw-storybook-addon -w packages/client
```

**Step 3: Write `.storybook/main.ts`**

> **TRAP: Vite Alias Hell + Tailwind Void.**
> Storybook runs its own Vite instance. It does NOT auto-inherit plugins or
> resolve aliases from the app's vite.config.ts in a monorepo. If we rely on
> auto-merging: (1) `@strand/*` path aliases will fail to resolve, and
> (2) Tailwind v4's Vite plugin won't run, leaving every utility class as dead CSS.
> Fix: explicitly merge aliases and register the Tailwind plugin in `viteFinal`.

```typescript
import path from 'node:path';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/ui/**/*.stories.@(ts|tsx)', '../src/ui/**/*.mdx'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
  ],
  framework: '@storybook/react-vite',
  viteFinal: async (config) => {
    const { mergeConfig } = await import('vite');
    const tailwind = (await import('@tailwindcss/vite')).default;

    // __dirname = packages/client/.storybook
    const CLIENT = path.resolve(__dirname, '..');
    const REPO = path.resolve(CLIENT, '../..');

    return mergeConfig(config, {
      plugins: [tailwind()],
      envDir: REPO,
      resolve: {
        alias: {
          '@strand/core': path.resolve(REPO, 'vendor/strand/src/index.ts'),
          '@strand/inference': path.resolve(REPO, 'packages/strand/src/inference.ts'),
        },
      },
    });
  },
};

export default config;
```

**Step 4: Write `.storybook/preview.tsx`**

> **TRAP: The Documentation Lie.**
> EntityPicker (and any future hook-bound component) uses React Query.
> Without a QueryClientProvider, those stories crash on render.
> Without MSW, we'd have to fake the component instead of testing the real one.
> Fix: global QueryClientProvider decorator + MSW initialization.

```tsx
import type { Preview } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initialize, mswLoader } from 'msw-storybook-addon';
import '../src/index.css';

// Start MSW — intercepts fetch/XHR in the browser
initialize();

// Shared client for all stories — no retries, no refetch on window focus
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    layout: 'centered',
  },
  loaders: [mswLoader],
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <div
          style={{
            background: 'var(--color-void)',
            padding: '2rem',
            minHeight: '100vh',
            width: '100%',
          }}
        >
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

export default preview;
```

**Step 5: Add scripts to `packages/client/package.json`**

Add to `"scripts"`:
```json
"storybook": "storybook dev -p 6006",
"build-storybook": "storybook build -o storybook-static"
```

**Step 6: Update `.gitignore`**

Append:
```
# Storybook
storybook-static/
```

**Step 7: Delete any auto-generated example stories**

```bash
rm -rf packages/client/src/stories/
```

**Step 8: Verify Storybook builds**

```bash
npm run build-storybook -w packages/client
```

Expected: Clean build, `packages/client/storybook-static/` created.

**Step 9: Commit**

```bash
git add packages/client/.storybook packages/client/package.json package-lock.json .gitignore
git commit -m "feat: initialize Storybook 8 with dark void decorator and a11y addon"
```

---

### Task 2: Stories for simple components — Button, Text, Heading, Badge, Card, Input

These components are thin CVA wrappers. Each story renders a grid of all variant combinations.

**Files:**
- Create: `packages/client/src/ui/Button.stories.tsx`
- Create: `packages/client/src/ui/Text.stories.tsx`
- Create: `packages/client/src/ui/Badge.stories.tsx`
- Create: `packages/client/src/ui/Card.stories.tsx`
- Create: `packages/client/src/ui/Input.stories.tsx`

**Step 1: Write `Button.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import Button from './Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  argTypes: {
    intent: {
      control: 'select',
      options: ['primary', 'ghost', 'danger', 'success', 'component', 'bare'],
    },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    pending: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { intent: 'primary', size: 'md', children: 'Button' },
};

export const AllIntents: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(['primary', 'ghost', 'danger', 'success', 'component', 'bare'] as const).map((intent) => (
        <Button key={intent} intent={intent}>
          {intent}
        </Button>
      ))}
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-2">
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Button key={size} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
};

export const Pending: Story = {
  args: { intent: 'primary', size: 'md', pending: true, children: 'Uploading...' },
};

export const IntentSizeGrid: Story = {
  render: () => {
    const intents = ['primary', 'ghost', 'danger', 'success', 'component'] as const;
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: `auto repeat(${sizes.length}, 1fr)` }}>
        <div />
        {sizes.map((s) => (
          <span key={s} className="text-fg-3 font-mono text-body text-center">{s}</span>
        ))}
        {intents.map((intent) => (
          <>
            <span key={`label-${intent}`} className="text-fg-3 font-mono text-body self-center">{intent}</span>
            {sizes.map((size) => (
              <Button key={`${intent}-${size}`} intent={intent} size={size}>
                Label
              </Button>
            ))}
          </>
        ))}
      </div>
    );
  },
};
```

**Step 2: Write `Text.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Text, Heading } from './Text';

const meta = {
  title: 'Primitives/Text',
  component: Text,
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['body', 'dim', 'muted', 'mono', 'error', 'caption'] as const).map((variant) => (
        <div key={variant} className="flex items-baseline gap-3">
          <span className="text-fg-3 font-mono text-body w-16">{variant}</span>
          <Text variant={variant}>The quick brown fox jumps over the lazy dog</Text>
        </div>
      ))}
    </div>
  ),
};

export const HeadingLevels: Story = {
  name: 'Heading Levels',
  render: () => (
    <div className="flex flex-col gap-4">
      {(['display', 'title', 'heading', 'subheading'] as const).map((level) => (
        <div key={level}>
          <span className="text-fg-3 font-mono text-body block mb-1">{level}</span>
          <Heading level={level}>GenomeHub</Heading>
        </div>
      ))}
    </div>
  ),
};
```

**Step 3: Write `Badge.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import Badge from './Badge';

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['status', 'count', 'filter'] },
    color: { control: 'select', options: ['accent', 'green', 'yellow', 'red', 'dim', 'default'] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { variant: 'status', color: 'accent', children: 'READY' },
};

export const VariantColorGrid: Story = {
  render: () => {
    const variants = ['status', 'count', 'filter'] as const;
    const colors = ['accent', 'green', 'yellow', 'red', 'dim', 'default'] as const;
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: `auto repeat(${colors.length}, 1fr)` }}>
        <div />
        {colors.map((c) => (
          <span key={c} className="text-fg-3 font-mono text-body text-center">{c}</span>
        ))}
        {variants.map((variant) => (
          <>
            <span key={`label-${variant}`} className="text-fg-3 font-mono text-body self-center">{variant}</span>
            {colors.map((color) => (
              <Badge key={`${variant}-${color}`} variant={variant} color={color}>
                {variant === 'count' ? '42' : variant === 'filter' ? 'parquet' : 'READY'}
              </Badge>
            ))}
          </>
        ))}
      </div>
    );
  },
};
```

**Step 4: Write `Card.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import Card from './Card';
import { Text, Heading } from './Text';

const meta = {
  title: 'Primitives/Card',
  component: Card,
  argTypes: {
    elevated: { control: 'boolean' },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="p-3" style={{ width: 320 }}>
      <Heading level="subheading" className="mb-2">Card Title</Heading>
      <Text variant="dim">Card content with some descriptive text about a genomic dataset.</Text>
    </Card>
  ),
};

export const Elevated: Story = {
  render: () => (
    <Card elevated className="p-3" style={{ width: 320 }}>
      <Heading level="subheading" className="mb-2">Elevated Card</Heading>
      <Text variant="dim">This card has a drop shadow.</Text>
    </Card>
  ),
};

export const Comparison: Story = {
  render: () => (
    <div className="flex gap-4">
      <Card className="p-3" style={{ width: 240 }}>
        <Text variant="muted">FLAT</Text>
        <Text variant="dim" className="mt-1">No shadow</Text>
      </Card>
      <Card elevated className="p-3" style={{ width: 240 }}>
        <Text variant="muted">ELEVATED</Text>
        <Text variant="dim" className="mt-1">With shadow</Text>
      </Card>
    </div>
  ),
};
```

**Step 5: Write `Input.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Input, Textarea } from './Input';

const meta = {
  title: 'Primitives/Input',
  component: Input,
  argTypes: {
    variant: { control: 'select', options: ['default', 'surface', 'transparent', 'mono'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { variant: 'default', size: 'md', placeholder: 'Search genomes...' },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3" style={{ width: 300 }}>
      {(['default', 'surface', 'transparent', 'mono'] as const).map((variant) => (
        <div key={variant}>
          <span className="text-fg-3 font-mono text-body block mb-1">{variant}</span>
          <Input variant={variant} placeholder={`${variant} input`} className="w-full" />
        </div>
      ))}
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3" style={{ width: 300 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size}>
          <span className="text-fg-3 font-mono text-body block mb-1">{size}</span>
          <Input size={size} placeholder={`${size} input`} className="w-full" />
        </div>
      ))}
    </div>
  ),
};

export const TextareaVariant: Story = {
  name: 'Textarea',
  render: () => (
    <Textarea
      placeholder="Enter description..."
      rows={4}
      className="w-full"
      style={{ width: 300 }}
    />
  ),
};
```

**Step 6: Verify Storybook builds**

```bash
npm run build-storybook -w packages/client
```

Expected: Clean build with 5 story files visible in sidebar.

**Step 7: Commit**

```bash
git add packages/client/src/ui/*.stories.tsx
git commit -m "feat: add stories for Button, Text, Badge, Card, Input"
```

---

### Task 3: Stories for interactive components — InlineInput, ComboBox, HashChip, HashChipPopover, FilterChip, ChipEditor

These components have internal state or popover behavior. Stories need mock data and action handlers.

**Files:**
- Create: `packages/client/src/ui/InlineInput.stories.tsx`
- Create: `packages/client/src/ui/ComboBox.stories.tsx`
- Create: `packages/client/src/ui/HashChip.stories.tsx`
- Create: `packages/client/src/ui/HashChipPopover.stories.tsx`
- Create: `packages/client/src/ui/FilterChip.stories.tsx`
- Create: `packages/client/src/ui/ChipEditor.stories.tsx`

**Step 1: Write `InlineInput.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import InlineInput from './InlineInput';

const meta = {
  title: 'Interactive/InlineInput',
  component: InlineInput,
} satisfies Meta<typeof InlineInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Body: Story = {
  render: () => {
    const [value, setValue] = useState('Untitled Dataset');
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-fg-3 font-mono text-body">Name:</span>
        <InlineInput value={value} onCommit={setValue} placeholder="Enter name" />
      </div>
    );
  },
};

export const Mono: Story = {
  render: () => {
    const [value, setValue] = useState('genome_v2.parquet');
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-fg-3 font-mono text-body">File:</span>
        <InlineInput value={value} onCommit={setValue} mono placeholder="filename" />
      </div>
    );
  },
};

export const FullWidth: Story = {
  render: () => {
    const [value, setValue] = useState('Full width mode');
    return (
      <div style={{ width: 400 }}>
        <InlineInput value={value} onCommit={setValue} fullWidth placeholder="Enter text" />
      </div>
    );
  },
};
```

**Step 2: Write `HashChip.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import HashChip from './HashChip';

const meta = {
  title: 'Interactive/HashChip',
  component: HashChip,
} satisfies Meta<typeof HashChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: { label: 'parquet' },
};

export const ColorSpectrum: Story = {
  name: 'Deterministic Color Spectrum',
  render: () => {
    const labels = [
      'parquet', 'csv', 'tsv', 'gff', 'gtf', 'gbk', 'fasta', 'fastq',
      'bam', 'vcf', 'bed', 'wig', 'bigwig', 'sam', 'cram', 'bcf',
    ];
    return (
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <HashChip key={label} label={label} />
        ))}
      </div>
    );
  },
};

export const Clickable: Story = {
  render: () => (
    <div className="flex gap-2">
      <HashChip label="E. coli" onClick={() => alert('Clicked E. coli')} />
      <HashChip label="S. cerevisiae" onClick={() => alert('Clicked S. cerevisiae')} />
    </div>
  ),
};

export const WithRemove: Story = {
  render: () => (
    <div className="flex gap-2">
      <HashChip label="parquet" onRemove={() => alert('Remove parquet')} />
      <HashChip label="csv" onRemove={() => alert('Remove csv')} />
    </div>
  ),
};

export const CustomColorKey: Story = {
  name: 'Custom Color Key',
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <HashChip label="Display A" colorKey="same-key" />
        <span className="text-fg-3 font-mono text-body">colorKey="same-key"</span>
      </div>
      <div className="flex items-center gap-2">
        <HashChip label="Display B" colorKey="same-key" />
        <span className="text-fg-3 font-mono text-body">colorKey="same-key"</span>
      </div>
      <span className="text-fg-3 font-mono text-body">Same colorKey = same color, different labels</span>
    </div>
  ),
};
```

**Step 3: Write `ComboBox.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import ComboBox from './ComboBox';

const ORGANISMS = [
  { id: '1', label: 'Escherichia coli', description: 'K-12 MG1655', group: 'Bacteria' },
  { id: '2', label: 'Bacillus subtilis', description: '168', group: 'Bacteria' },
  { id: '3', label: 'Saccharomyces cerevisiae', description: 'S288C', group: 'Fungi' },
  { id: '4', label: 'Candida albicans', description: 'SC5314', group: 'Fungi' },
  { id: '5', label: 'Arabidopsis thaliana', description: 'Col-0', group: 'Plants' },
];

const meta = {
  title: 'Interactive/ComboBox',
  component: ComboBox,
} satisfies Meta<typeof ComboBox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <div style={{ width: 300 }}>
        <ComboBox
          items={ORGANISMS}
          value={value}
          onValueChange={setValue}
          placeholder="Select organism..."
        />
      </div>
    );
  },
};

export const WithGroups: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <div style={{ width: 300 }}>
        <ComboBox
          items={ORGANISMS}
          value={value}
          onValueChange={setValue}
          placeholder="Grouped items..."
        />
      </div>
    );
  },
};

export const WithRecents: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <div style={{ width: 300 }}>
        <ComboBox
          items={ORGANISMS}
          value={value}
          onValueChange={setValue}
          placeholder="With recent items..."
          recentIds={['1', '3']}
        />
      </div>
    );
  },
};

export const WithCreate: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <div style={{ width: 300 }}>
        <ComboBox
          items={ORGANISMS}
          value={value}
          onValueChange={setValue}
          placeholder="Type to create..."
          onCreate={(search) => alert(`Create: ${search}`)}
        />
      </div>
    );
  },
};

export const Sizes: Story = {
  render: () => {
    const [v1, setV1] = useState('');
    const [v2, setV2] = useState('');
    return (
      <div className="flex flex-col gap-3" style={{ width: 300 }}>
        <div>
          <span className="text-fg-3 font-mono text-body block mb-1">sm</span>
          <ComboBox items={ORGANISMS} value={v1} onValueChange={setV1} size="sm" placeholder="Small" />
        </div>
        <div>
          <span className="text-fg-3 font-mono text-body block mb-1">md</span>
          <ComboBox items={ORGANISMS} value={v2} onValueChange={setV2} size="md" placeholder="Medium" />
        </div>
      </div>
    );
  },
};
```

**Step 4: Write `HashChipPopover.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import HashChipPopover from './HashChipPopover';

const FILE_TYPES = [
  { id: 'parquet', label: 'parquet' },
  { id: 'csv', label: 'csv' },
  { id: 'tsv', label: 'tsv' },
  { id: 'gff', label: 'gff' },
  { id: 'fasta', label: 'fasta' },
  { id: 'fastq', label: 'fastq' },
];

const meta = {
  title: 'Interactive/HashChipPopover',
  component: HashChipPopover,
} satisfies Meta<typeof HashChipPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <div style={{ width: 240 }}>
        <HashChipPopover
          items={FILE_TYPES}
          value={value}
          onSelect={setValue}
          placeholder="File type..."
        />
      </div>
    );
  },
};

export const WithCreate: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <div style={{ width: 240 }}>
        <HashChipPopover
          items={FILE_TYPES}
          value={value}
          onSelect={setValue}
          placeholder="File type..."
          onCreate={(label) => alert(`Create: ${label}`)}
        />
      </div>
    );
  },
};
```

**Step 5: Write `FilterChip.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import FilterChip from './FilterChip';

const TECHNIQUES = [
  { id: '1', label: 'RNA-seq' },
  { id: '2', label: 'ChIP-seq' },
  { id: '3', label: 'ATAC-seq' },
  { id: '4', label: 'Hi-C' },
  { id: '5', label: 'CUT&Tag' },
];

const meta = {
  title: 'Interactive/FilterChip',
  component: FilterChip,
} satisfies Meta<typeof FilterChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return <FilterChip label="Technique" items={TECHNIQUES} value={value} onValueChange={setValue} />;
  },
};

export const WithSelection: Story = {
  render: () => {
    const [value, setValue] = useState('1');
    return <FilterChip label="Technique" items={TECHNIQUES} value={value} onValueChange={setValue} />;
  },
};
```

**Step 6: Write `ChipEditor.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import ChipEditor from './ChipEditor';
import HashChipPopover from './HashChipPopover';
import type { HashChipItem } from './HashChipPopover';

const ALL_ITEMS: HashChipItem[] = [
  { id: '1', label: 'RNA-seq' },
  { id: '2', label: 'ChIP-seq' },
  { id: '3', label: 'ATAC-seq' },
  { id: '4', label: 'Hi-C' },
  { id: '5', label: 'CUT&Tag' },
  { id: '6', label: 'Ribo-seq' },
];

const meta = {
  title: 'Interactive/ChipEditor',
  component: ChipEditor,
} satisfies Meta<typeof ChipEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [items, setItems] = useState<HashChipItem[]>([ALL_ITEMS[0], ALL_ITEMS[2]]);
    return (
      <ChipEditor
        items={items}
        onAdd={(id) => {
          const found = ALL_ITEMS.find((i) => i.id === id);
          if (found) setItems((prev) => [...prev, found]);
        }}
        onRemove={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
        renderPicker={(props) => (
          <HashChipPopover
            items={ALL_ITEMS.filter((a) => !items.some((i) => i.id === a.id))}
            value={props.value}
            onSelect={props.onValueChange}
            trigger={props.trigger}
            placeholder="Add technique..."
          />
        )}
      />
    );
  },
};

export const Empty: Story = {
  render: () => (
    <ChipEditor
      items={[]}
      onAdd={() => {}}
      onRemove={() => {}}
      renderPicker={(props) => (
        <HashChipPopover
          items={ALL_ITEMS}
          value={props.value}
          onSelect={props.onValueChange}
          trigger={props.trigger}
          placeholder="Add..."
        />
      )}
    />
  ),
};

export const Disabled: Story = {
  render: () => (
    <ChipEditor
      items={[ALL_ITEMS[0], ALL_ITEMS[1]]}
      onAdd={() => {}}
      onRemove={() => {}}
      disabled
      renderPicker={() => null}
    />
  ),
};

export const MaxVisible: Story = {
  render: () => (
    <ChipEditor
      items={ALL_ITEMS}
      onAdd={() => {}}
      onRemove={() => {}}
      maxVisible={3}
      renderPicker={() => null}
    />
  ),
};
```

**Step 7: Verify Storybook builds**

```bash
npm run build-storybook -w packages/client
```

Expected: Clean build, all interactive stories render in sidebar.

**Step 8: Commit**

```bash
git add packages/client/src/ui/*.stories.tsx
git commit -m "feat: add stories for InlineInput, ComboBox, HashChip, FilterChip, ChipEditor"
```

---

### Task 4: Stories for animated components — Stepper, RiverGauge

These are the showcase components. Stories demonstrate all animation physics modes.

**Files:**
- Create: `packages/client/src/ui/Stepper.stories.tsx`
- Create: `packages/client/src/ui/RiverGauge.stories.tsx`

**Step 1: Write `Stepper.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Stepper, { type StepperStep, type StepHealth } from './Stepper';

const PIPELINE_STEPS: StepperStep[] = [
  { key: 'connect', label: 'Connecting' },
  { key: 'scan', label: 'Scanning' },
  { key: 'query', label: 'Querying' },
  { key: 'ready', label: 'Ready' },
];

const ENGINE_STEPS: StepperStep[] = [
  { key: 'poll', label: 'Polling' },
  { key: 'convert', label: 'Converting' },
  { key: 'profile', label: 'Profiling' },
  { key: 'histogram', label: 'Histograms' },
  { key: 'ready', label: 'Ready' },
];

const meta = {
  title: 'Animated/Stepper',
  component: Stepper,
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pipeline: Story = {
  render: () => {
    const [active, setActive] = useState(0);
    return (
      <div style={{ width: 400 }}>
        <Stepper steps={PIPELINE_STEPS} active={active} />
        <div className="flex gap-2 mt-4 justify-center">
          {PIPELINE_STEPS.map((_, i) => (
            <button
              key={i}
              className="sigil sigil-sm"
              onClick={() => setActive(i)}
            >
              Step {i}
            </button>
          ))}
        </div>
      </div>
    );
  },
};

export const WithProgress: Story = {
  render: () => {
    const [active, setActive] = useState(1);
    const [progress, setProgress] = useState(50);
    return (
      <div style={{ width: 400 }}>
        <Stepper steps={ENGINE_STEPS} active={active} progress={progress} />
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-fg-3 font-mono text-body">
            Active step: {active}
            <input
              type="range"
              min={0}
              max={ENGINE_STEPS.length - 1}
              value={active}
              onChange={(e) => setActive(Number(e.target.value))}
              className="ml-2"
            />
          </label>
          <label className="text-fg-3 font-mono text-body">
            Progress: {progress}%
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="ml-2"
            />
          </label>
        </div>
      </div>
    );
  },
};

export const HealthStates: Story = {
  render: () => {
    const [health, setHealth] = useState<StepHealth>('normal');
    return (
      <div style={{ width: 400 }}>
        <Stepper
          steps={PIPELINE_STEPS}
          active={2}
          stepHealth={{ query: health }}
        />
        <div className="flex gap-2 mt-4 justify-center">
          {(['normal', 'warning', 'error'] as const).map((h) => (
            <button
              key={h}
              className={`sigil sigil-sm ${health === h ? 'active' : ''}`}
              onClick={() => setHealth(h)}
            >
              {h}
            </button>
          ))}
        </div>
      </div>
    );
  },
};

export const ErrorMessage: Story = {
  render: () => (
    <div style={{ width: 400 }}>
      <Stepper
        steps={[
          { key: 'connect', label: 'Connecting' },
          { key: 'scan', label: 'Scanning' },
          { key: 'query', label: 'Querying', error: 'Connection timeout — retrying in 5s' },
          { key: 'ready', label: 'Ready' },
        ]}
        active={2}
      />
    </div>
  ),
};

export const Flourish: Story = {
  name: 'Final Step Flourish',
  render: () => (
    <div style={{ width: 400 }}>
      <Stepper steps={PIPELINE_STEPS} active={3} />
    </div>
  ),
};
```

**Step 2: Write `RiverGauge.stories.tsx`**

```tsx
import { useState, useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import RiverGauge from './RiverGauge';

const meta = {
  title: 'Animated/RiverGauge',
  component: RiverGauge,
} satisfies Meta<typeof RiverGauge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tide: Story = {
  render: () => {
    const [current, setCurrent] = useState(4200);
    return (
      <div style={{ width: 300 }}>
        <RiverGauge current={current} total={10000} variant="tide" />
        <input
          type="range"
          min={0}
          max={10000}
          value={current}
          onChange={(e) => setCurrent(Number(e.target.value))}
          className="w-full mt-3"
        />
      </div>
    );
  },
};

export const Waterfall: Story = {
  render: () => {
    const [current, setCurrent] = useState(0);
    const [key, setKey] = useState(0);
    const interval = useRef<ReturnType<typeof setInterval>>();

    const start = () => {
      setCurrent(0);
      setKey((k) => k + 1);
      let n = 0;
      clearInterval(interval.current);
      interval.current = setInterval(() => {
        n += Math.random() * 800;
        if (n >= 10000) {
          n = 10000;
          clearInterval(interval.current);
        }
        setCurrent(Math.round(n));
      }, 200);
    };

    useEffect(() => () => clearInterval(interval.current), []);

    return (
      <div style={{ width: 300 }}>
        <RiverGauge current={current} total={10000} variant="waterfall" resetKey={key} />
        <button className="sigil sigil-sm mt-3" onClick={start}>
          Start waterfall
        </button>
      </div>
    );
  },
};

export const FlowStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6" style={{ width: 300 }}>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">normal</span>
        <RiverGauge current={6500} total={10000} flowState="normal" />
      </div>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">pending</span>
        <RiverGauge current={6500} total={10000} flowState="pending" />
      </div>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">stalled</span>
        <RiverGauge current={6500} total={10000} flowState="stalled" />
      </div>
    </div>
  ),
};

export const Compact: Story = {
  render: () => (
    <div className="flex flex-col gap-4" style={{ width: 200 }}>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">compact</span>
        <RiverGauge current={4200} total={10000} compact />
      </div>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">full</span>
        <RiverGauge current={4200} total={10000} />
      </div>
    </div>
  ),
};

export const Accent: Story = {
  render: () => (
    <div style={{ width: 300 }}>
      <RiverGauge current={8500} total={10000} accent />
    </div>
  ),
};

export const StatusLabel: Story = {
  render: () => (
    <div style={{ width: 300 }}>
      <RiverGauge current={0} total={0} statusLabel="query failed" />
    </div>
  ),
};
```

**Step 3: Verify Storybook builds**

```bash
npm run build-storybook -w packages/client
```

**Step 4: Commit**

```bash
git add packages/client/src/ui/Stepper.stories.tsx packages/client/src/ui/RiverGauge.stories.tsx
git commit -m "feat: add stories for Stepper and RiverGauge with interactive controls"
```

---

### Task 5: Stories for EntityPicker (MSW-mocked — the real components)

> **TRAP: The Documentation Lie.**
> The original plan rendered `HashChipPopover` with static data and *called*
> it EntityPicker. That's a second HashChipPopover story, not a test of
> EntityPicker. If the data-fetching wire-up breaks, the story still passes.
> Fix: render the **real** picker components with MSW intercepting the network.

**Files:**
- Create: `packages/client/src/ui/EntityPicker.stories.tsx`

**Step 1: Write `EntityPicker.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import {
  CollectionPicker,
  OrganismPicker,
  FileTypePicker,
  TechniquePicker,
  RelationPicker,
} from './EntityPicker';

// ── Mock API responses matching real entity shapes ──

const MOCK_ORGANISMS = [
  { id: '1', genus: 'Escherichia', species: 'coli', strain: 'K-12 MG1655', commonName: null, ncbiTaxId: 511145, referenceGenome: 'GCF_000005845.2', displayName: 'Escherichia coli K-12 MG1655', fileCount: 12, collectionCount: 3, createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', genus: 'Saccharomyces', species: 'cerevisiae', strain: 'S288C', commonName: 'Baker\'s yeast', ncbiTaxId: 559292, referenceGenome: 'GCF_000146045.2', displayName: 'Saccharomyces cerevisiae S288C', fileCount: 8, collectionCount: 2, createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', genus: 'Arabidopsis', species: 'thaliana', strain: 'Col-0', commonName: 'Thale cress', ncbiTaxId: 3702, referenceGenome: 'GCF_000001735.4', displayName: 'Arabidopsis thaliana Col-0', fileCount: 5, collectionCount: 1, createdAt: '2025-01-03T00:00:00Z' },
  { id: '4', genus: 'Bacillus', species: 'subtilis', strain: '168', commonName: null, ncbiTaxId: 224308, referenceGenome: null, displayName: 'Bacillus subtilis 168', fileCount: 3, collectionCount: 1, createdAt: '2025-01-04T00:00:00Z' },
];

const MOCK_COLLECTIONS = [
  { id: '1', name: 'RNA-seq Timecourse', description: null, types: ['experiment'], metadata: null, techniques: [{ id: '1', name: 'RNA-seq' }], organisms: [{ id: '1', displayName: 'Escherichia coli K-12 MG1655' }], createdBy: null, fileCount: 6, createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'ChIP-seq Peaks', description: 'Transcription factor binding sites', types: ['experiment'], metadata: null, techniques: [{ id: '2', name: 'ChIP-seq' }], organisms: [{ id: '2', displayName: 'Saccharomyces cerevisiae S288C' }], createdBy: null, fileCount: 4, createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'ATAC-seq Atlas', description: null, types: ['reference'], metadata: null, techniques: [{ id: '3', name: 'ATAC-seq' }], organisms: [{ id: '3', displayName: 'Arabidopsis thaliana Col-0' }], createdBy: null, fileCount: 3, createdAt: '2025-01-03T00:00:00Z' },
];

const MOCK_TECHNIQUES = [
  { id: '1', name: 'RNA-seq', description: 'Transcriptome sequencing', defaultTags: ['expression'], createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'ChIP-seq', description: 'Chromatin immunoprecipitation', defaultTags: ['binding'], createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'ATAC-seq', description: 'Open chromatin profiling', defaultTags: ['accessibility'], createdAt: '2025-01-03T00:00:00Z' },
  { id: '4', name: 'Hi-C', description: 'Chromosome conformation capture', defaultTags: ['3d-genome'], createdAt: '2025-01-04T00:00:00Z' },
];

const MOCK_FILE_TYPES = [
  { id: '1', name: 'parquet', description: 'Columnar storage format', createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'csv', description: 'Comma-separated values', createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'gff', description: 'General Feature Format', createdAt: '2025-01-03T00:00:00Z' },
  { id: '4', name: 'fasta', description: 'Nucleotide/protein sequences', createdAt: '2025-01-04T00:00:00Z' },
  { id: '5', name: 'fastq', description: 'Sequences with quality scores', createdAt: '2025-01-05T00:00:00Z' },
];

const MOCK_RELATION_TYPES = [
  { id: '1', name: 'derived_from', description: 'This file was derived from another', createdAt: '2025-01-01T00:00:00Z' },
  { id: '2', name: 'replicate_of', description: 'Biological or technical replicate', createdAt: '2025-01-02T00:00:00Z' },
  { id: '3', name: 'control_for', description: 'Control sample for an experiment', createdAt: '2025-01-03T00:00:00Z' },
];

// ── MSW handlers — intercept the real API calls ──

const handlers = [
  http.get('/api/organisms', () => HttpResponse.json(MOCK_ORGANISMS)),
  http.get('/api/collections', () => HttpResponse.json(MOCK_COLLECTIONS)),
  http.get('/api/techniques', () => HttpResponse.json(MOCK_TECHNIQUES)),
  http.get('/api/file-types', () => HttpResponse.json(MOCK_FILE_TYPES)),
  http.get('/api/relation-types', () => HttpResponse.json(MOCK_RELATION_TYPES)),
];

const meta = {
  title: 'Interactive/EntityPicker',
  parameters: {
    msw: { handlers },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function PickerStory({ children }: { children: (props: { value: string; onChange: (v: string) => void }) => React.ReactNode }) {
  const [value, setValue] = useState('');
  return <div style={{ width: 280 }}>{children({ value, onChange: setValue })}</div>;
}

export const Collection: Story = {
  name: 'CollectionPicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <CollectionPicker value={value} onValueChange={onChange} placeholder="Collection..." />
      )}
    </PickerStory>
  ),
};

export const Organism: Story = {
  name: 'OrganismPicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <OrganismPicker value={value} onValueChange={onChange} placeholder="Organism..." />
      )}
    </PickerStory>
  ),
};

export const FileType: Story = {
  name: 'FileTypePicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <FileTypePicker value={value} onValueChange={onChange} placeholder="File type..." />
      )}
    </PickerStory>
  ),
};

export const Technique: Story = {
  name: 'TechniquePicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <TechniquePicker value={value} onValueChange={onChange} placeholder="Technique..." />
      )}
    </PickerStory>
  ),
};

export const Relation: Story = {
  name: 'RelationPicker',
  render: () => (
    <PickerStory>
      {({ value, onChange }) => (
        <RelationPicker value={value} onValueChange={onChange} placeholder="Relation..." />
      )}
    </PickerStory>
  ),
};
```

**Step 2: Verify and commit**

```bash
npm run build-storybook -w packages/client
git add packages/client/src/ui/EntityPicker.stories.tsx
git commit -m "feat: add EntityPicker stories with MSW-mocked API endpoints"
```

---

### Task 6: Materials documentation page

An MDX page showcasing the CSS-only classes: surfaces, controls, tracks, color spectrum, animations.

**Files:**
- Create: `packages/client/src/ui/Materials.mdx`

**Step 1: Write `Materials.mdx`**

```mdx
import { Meta } from '@storybook/blocks';

<Meta title="Foundation/Materials" />

# Materials

CSS-only classes that define the visual language. These are not React components — they are
applied directly as class names. All defined in `index.css`.

## Surfaces

<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1rem' }}>
  <div>
    <div
      className="glass-canopy"
      style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
    >
      <span className="font-mono text-body text-fg-3">.glass-canopy</span>
    </div>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
      Translucent void + backdrop-blur. Sticky header panels.
    </p>
  </div>
  <div>
    <div
      className="vault-door"
      style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
    >
      <span className="font-mono text-body text-fg-3">.vault-door</span>
    </div>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
      Dark overlay with hover brightening. Collapsible drawer toggles.
    </p>
  </div>
  <div>
    <div
      className="sidebar-surface"
      style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
    >
      <span className="font-mono text-body text-fg-3">.sidebar-surface</span>
    </div>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
      Sidebar background with right seam border.
    </p>
  </div>
</div>

## Controls

<div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
  <div style={{ textAlign: 'center' }}>
    <button className="sigil">Sigil</button>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>.sigil</p>
  </div>
  <div style={{ textAlign: 'center' }}>
    <button className="sigil active">Active</button>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>.sigil.active</p>
  </div>
  <div style={{ textAlign: 'center' }}>
    <button className="sigil sigil-sm">Small</button>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>.sigil-sm</p>
  </div>
  <div style={{ textAlign: 'center', padding: '0 1rem' }}>
    <div style={{ position: 'relative', width: 60, height: 32 }}>
      <button className="ghost" style={{ position: 'absolute', inset: 0 }}>Ghost</button>
    </div>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>.ghost</p>
  </div>
  <div style={{ textAlign: 'center', padding: '0 1rem' }}>
    <div style={{ position: 'relative', width: 60, height: 32 }}>
      <button className="ghost awake" style={{ position: 'absolute', inset: 0 }}>Awake</button>
    </div>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>.ghost.awake</p>
  </div>
</div>

## Tracks

<div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem', maxWidth: 400 }}>
  <div>
    <div className="river-groove" style={{ height: 16 }}>
      <div className="river-fill" style={{ height: '100%', clipPath: 'inset(0 35% 0 0)' }} />
    </div>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
      .river-groove + .river-fill (65%)
    </p>
  </div>
  <div>
    <div className="range-track" style={{ height: 8, borderRadius: 4 }} />
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
      .range-track
    </p>
  </div>
</div>

## Cyan Spectrum

<div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem', alignItems: 'flex-end' }}>
  {[
    { label: '100%', style: { color: 'var(--color-cyan)' } },
    { label: '70%', style: { color: 'oklch(0.75 0.14 195 / 0.7)' } },
    { label: '30%', style: { color: 'oklch(0.75 0.14 195 / 0.3)' } },
    { label: '10%', style: { color: 'oklch(0.75 0.14 195 / 0.1)' } },
  ].map(({ label, style }) => (
    <div key={label} style={{ textAlign: 'center' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 8,
          background: style.color,
        }}
      />
      <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
        cyan/{label}
      </p>
    </div>
  ))}
</div>

## Animations

<div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', marginTop: '1rem' }}>
  <div style={{ textAlign: 'center' }}>
    <div
      className="animate-fade-in"
      style={{ width: 80, height: 40, background: 'var(--color-cyan)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span className="font-mono text-body" style={{ color: 'var(--color-void)' }}>382ms</span>
    </div>
    <p style={{ color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
      .animate-fade-in
    </p>
  </div>
</div>

## Timing Constants

| Token | Value | Derivation |
|-------|-------|------------|
| `--t-phi` | 382ms | 1000/\u03C6\u00B2 |
| `--t-phi-half` | 191ms | 382/2 |
| `--ease-phi` | cubic-bezier(0.382, 0, 0.618, 1) | Control points at 1/\u03C6\u00B2 and 1/\u03C6 |
| `--ease-out` | cubic-bezier(0.34, 1.56, 0.64, 1) | Bounce overshoot |
</div>
```

**Step 2: Verify and commit**

```bash
npm run build-storybook -w packages/client
git add packages/client/src/ui/Materials.mdx
git commit -m "feat: add Materials documentation page for CSS classes and design tokens"
```

---

### Task 7: GitHub Actions deployment workflow

**Files:**
- Create: `.github/workflows/storybook.yml`

**Step 1: Write the workflow**

```yaml
name: Deploy Storybook to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npm run build-storybook -w packages/client

      - uses: actions/upload-pages-artifact@v3
        with:
          path: packages/client/storybook-static

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/storybook.yml
git commit -m "ci: add GitHub Actions workflow for Storybook deployment to Pages"
```

---

### Task 8: Final verification and squash commit

**Step 1: Full TypeScript check**

```bash
npx tsc --noEmit -p packages/client/tsconfig.json
```

Expected: Clean, zero errors.

**Step 2: Full Storybook build**

```bash
npm run build-storybook -w packages/client
```

Expected: Clean build. All stories compile. `storybook-static/` is generated.

**Step 3: Serve locally and verify**

```bash
npx http-server packages/client/storybook-static -p 6006
```

Open `http://localhost:6006` — verify:
- Sidebar shows Foundation/Materials, Primitives/*, Interactive/*, Animated/*
- Dark void background on all stories
- Controls panel works for Button/Badge/Input
- Stepper flourish animation plays at final step
- RiverGauge waterfall ratchets and dissolves
- ComboBox/HashChipPopover popovers open and close
- A11y panel shows no critical violations

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve any Storybook build issues"
```

---

Plan complete and saved to `docs/plans/2026-03-04-component-catalog.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints

Which approach?
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
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `auto repeat(${sizes.length}, 1fr)` }}
      >
        <div />
        {sizes.map((s) => (
          <span key={s} className="text-fg-3 font-mono text-body text-center">
            {s}
          </span>
        ))}
        {intents.map((intent) => (
          <>
            <span
              key={`label-${intent}`}
              className="text-fg-3 font-mono text-body self-center"
            >
              {intent}
            </span>
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

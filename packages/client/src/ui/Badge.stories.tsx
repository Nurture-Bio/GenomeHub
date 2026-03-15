import type { Meta, StoryObj } from '@storybook/react';
import Badge from './Badge';

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['status', 'count', 'filter'] },
    color: {
      control: 'select',
      options: ['accent', 'green', 'yellow', 'red', 'dim', 'default'],
    },
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
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `auto repeat(${colors.length}, 1fr)` }}
      >
        <div />
        {colors.map((c) => (
          <span key={c} className="text-text-faint font-mono text-body text-center">
            {c}
          </span>
        ))}
        {variants.map((variant) => (
          <>
            <span
              key={`label-${variant}`}
              className="text-text-faint font-mono text-body self-center"
            >
              {variant}
            </span>
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

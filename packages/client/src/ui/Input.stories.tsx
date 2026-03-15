import type { Meta, StoryObj } from '@storybook/react';
import { Input, Textarea } from './Input';

const meta = {
  title: 'Primitives/Input',
  component: Input,
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'surface', 'transparent', 'mono'],
    },
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
          <span className="text-text-faint font-mono text-body block mb-1">{variant}</span>
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
          <span className="text-text-faint font-mono text-body block mb-1">{size}</span>
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

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

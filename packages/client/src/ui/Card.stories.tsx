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
      <Heading level="subheading" className="mb-2">
        Card Title
      </Heading>
      <Text variant="dim">
        Card content with some descriptive text about a genomic dataset.
      </Text>
    </Card>
  ),
};

export const Elevated: Story = {
  render: () => (
    <Card elevated className="p-3" style={{ width: 320 }}>
      <Heading level="subheading" className="mb-2">
        Elevated Card
      </Heading>
      <Text variant="dim">This card has a drop shadow.</Text>
    </Card>
  ),
};

export const Comparison: Story = {
  render: () => (
    <div className="flex gap-4">
      <Card className="p-3" style={{ width: 240 }}>
        <Text variant="muted">FLAT</Text>
        <Text variant="dim" className="mt-1">
          No shadow
        </Text>
      </Card>
      <Card elevated className="p-3" style={{ width: 240 }}>
        <Text variant="muted">ELEVATED</Text>
        <Text variant="dim" className="mt-1">
          With shadow
        </Text>
      </Card>
    </div>
  ),
};

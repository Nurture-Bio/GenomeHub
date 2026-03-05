import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import InlineInput from './InlineInput';

const meta = {
  title: 'Interactive/InlineInput',
  component: InlineInput,
} satisfies Meta<typeof InlineInput>;

export default meta;
type Story = StoryObj;

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

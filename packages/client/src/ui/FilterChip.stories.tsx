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

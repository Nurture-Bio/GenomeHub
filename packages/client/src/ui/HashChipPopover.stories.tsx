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

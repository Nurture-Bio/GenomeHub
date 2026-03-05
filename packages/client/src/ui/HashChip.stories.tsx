import type { Meta, StoryObj } from '@storybook/react';
import HashChip from './HashChip';

const meta = {
  title: 'Interactive/HashChip',
  component: HashChip,
} satisfies Meta<typeof HashChip>;

export default meta;
type Story = StoryObj;

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

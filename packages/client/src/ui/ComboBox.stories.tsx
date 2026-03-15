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
type Story = StoryObj;

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
          <span className="text-text-faint font-mono text-body block mb-1">sm</span>
          <ComboBox items={ORGANISMS} value={v1} onValueChange={setV1} size="sm" placeholder="Small" />
        </div>
        <div>
          <span className="text-text-faint font-mono text-body block mb-1">md</span>
          <ComboBox items={ORGANISMS} value={v2} onValueChange={setV2} size="md" placeholder="Medium" />
        </div>
      </div>
    );
  },
};

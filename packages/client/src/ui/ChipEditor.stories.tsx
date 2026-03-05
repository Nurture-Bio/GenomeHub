import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import ChipEditor from './ChipEditor';
import HashChipPopover from './HashChipPopover';
import type { HashChipItem } from './HashChipPopover';

const ALL_ITEMS: HashChipItem[] = [
  { id: '1', label: 'RNA-seq' },
  { id: '2', label: 'ChIP-seq' },
  { id: '3', label: 'ATAC-seq' },
  { id: '4', label: 'Hi-C' },
  { id: '5', label: 'CUT&Tag' },
  { id: '6', label: 'Ribo-seq' },
];

const meta = {
  title: 'Interactive/ChipEditor',
  component: ChipEditor,
} satisfies Meta<typeof ChipEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [items, setItems] = useState<HashChipItem[]>([ALL_ITEMS[0], ALL_ITEMS[2]]);
    return (
      <ChipEditor
        items={items}
        onAdd={(id) => {
          const found = ALL_ITEMS.find((i) => i.id === id);
          if (found) setItems((prev) => [...prev, found]);
        }}
        onRemove={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
        renderPicker={(props) => (
          <HashChipPopover
            items={ALL_ITEMS.filter((a) => !items.some((i) => i.id === a.id))}
            value={props.value}
            onSelect={props.onValueChange}
            trigger={props.trigger}
            placeholder="Add technique..."
          />
        )}
      />
    );
  },
};

export const Empty: Story = {
  render: () => (
    <ChipEditor
      items={[]}
      onAdd={() => {}}
      onRemove={() => {}}
      renderPicker={(props) => (
        <HashChipPopover
          items={ALL_ITEMS}
          value={props.value}
          onSelect={props.onValueChange}
          trigger={props.trigger}
          placeholder="Add..."
        />
      )}
    />
  ),
};

export const Disabled: Story = {
  render: () => (
    <ChipEditor
      items={[ALL_ITEMS[0], ALL_ITEMS[1]]}
      onAdd={() => {}}
      onRemove={() => {}}
      disabled
      renderPicker={() => null}
    />
  ),
};

export const MaxVisible: Story = {
  render: () => (
    <ChipEditor
      items={ALL_ITEMS}
      onAdd={() => {}}
      onRemove={() => {}}
      maxVisible={3}
      renderPicker={() => null}
    />
  ),
};

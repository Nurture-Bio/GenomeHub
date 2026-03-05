import { useState, useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import RiverGauge from './RiverGauge';

const meta = {
  title: 'Animated/RiverGauge',
  component: RiverGauge,
} satisfies Meta<typeof RiverGauge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tide: Story = {
  render: () => {
    const [current, setCurrent] = useState(4200);
    return (
      <div style={{ width: 300 }}>
        <RiverGauge current={current} total={10000} variant="tide" />
        <input
          type="range"
          min={0}
          max={10000}
          value={current}
          onChange={(e) => setCurrent(Number(e.target.value))}
          className="w-full mt-3"
        />
      </div>
    );
  },
};

export const Waterfall: Story = {
  render: () => {
    const [current, setCurrent] = useState(0);
    const [key, setKey] = useState(0);
    const interval = useRef<ReturnType<typeof setInterval>>();

    const start = () => {
      setCurrent(0);
      setKey((k) => k + 1);
      let n = 0;
      clearInterval(interval.current);
      interval.current = setInterval(() => {
        n += Math.random() * 800;
        if (n >= 10000) {
          n = 10000;
          clearInterval(interval.current);
        }
        setCurrent(Math.round(n));
      }, 200);
    };

    useEffect(() => () => clearInterval(interval.current), []);

    return (
      <div style={{ width: 300 }}>
        <RiverGauge
          current={current}
          total={10000}
          variant="waterfall"
          resetKey={key}
        />
        <button className="sigil sigil-sm mt-3" onClick={start}>
          Start waterfall
        </button>
      </div>
    );
  },
};

export const FlowStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6" style={{ width: 300 }}>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">
          normal
        </span>
        <RiverGauge current={6500} total={10000} flowState="normal" />
      </div>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">
          pending
        </span>
        <RiverGauge current={6500} total={10000} flowState="pending" />
      </div>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">
          stalled
        </span>
        <RiverGauge current={6500} total={10000} flowState="stalled" />
      </div>
    </div>
  ),
};

export const Compact: Story = {
  render: () => (
    <div className="flex flex-col gap-4" style={{ width: 200 }}>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">
          compact
        </span>
        <RiverGauge current={4200} total={10000} compact />
      </div>
      <div>
        <span className="text-fg-3 font-mono text-body block mb-1">full</span>
        <RiverGauge current={4200} total={10000} />
      </div>
    </div>
  ),
};

export const Accent: Story = {
  render: () => (
    <div style={{ width: 300 }}>
      <RiverGauge current={8500} total={10000} accent />
    </div>
  ),
};

export const StatusLabel: Story = {
  render: () => (
    <div style={{ width: 300 }}>
      <RiverGauge current={0} total={0} statusLabel="query failed" />
    </div>
  ),
};

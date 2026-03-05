import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Stepper, { type StepperStep, type StepHealth } from './Stepper';

const PIPELINE_STEPS: StepperStep[] = [
  { key: 'connect', label: 'Connecting' },
  { key: 'scan', label: 'Scanning' },
  { key: 'query', label: 'Querying' },
  { key: 'ready', label: 'Ready' },
];

const ENGINE_STEPS: StepperStep[] = [
  { key: 'poll', label: 'Polling' },
  { key: 'convert', label: 'Converting' },
  { key: 'profile', label: 'Profiling' },
  { key: 'histogram', label: 'Histograms' },
  { key: 'ready', label: 'Ready' },
];

const meta = {
  title: 'Animated/Stepper',
  component: Stepper,
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pipeline: Story = {
  render: () => {
    const [active, setActive] = useState(0);
    return (
      <div style={{ width: 400 }}>
        <Stepper steps={PIPELINE_STEPS} active={active} />
        <div className="flex gap-2 mt-4 justify-center">
          {PIPELINE_STEPS.map((_, i) => (
            <button
              key={i}
              className="sigil sigil-sm"
              onClick={() => setActive(i)}
            >
              Step {i}
            </button>
          ))}
        </div>
      </div>
    );
  },
};

export const WithProgress: Story = {
  render: () => {
    const [active, setActive] = useState(1);
    const [progress, setProgress] = useState(50);
    return (
      <div style={{ width: 400 }}>
        <Stepper steps={ENGINE_STEPS} active={active} progress={progress} />
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-fg-3 font-mono text-body">
            Active step: {active}
            <input
              type="range"
              min={0}
              max={ENGINE_STEPS.length - 1}
              value={active}
              onChange={(e) => setActive(Number(e.target.value))}
              className="ml-2"
            />
          </label>
          <label className="text-fg-3 font-mono text-body">
            Progress: {progress}%
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="ml-2"
            />
          </label>
        </div>
      </div>
    );
  },
};

export const HealthStates: Story = {
  render: () => {
    const [health, setHealth] = useState<StepHealth>('normal');
    return (
      <div style={{ width: 400 }}>
        <Stepper
          steps={PIPELINE_STEPS}
          active={2}
          stepHealth={{ query: health }}
        />
        <div className="flex gap-2 mt-4 justify-center">
          {(['normal', 'warning', 'error'] as const).map((h) => (
            <button
              key={h}
              className={`sigil sigil-sm ${health === h ? 'active' : ''}`}
              onClick={() => setHealth(h)}
            >
              {h}
            </button>
          ))}
        </div>
      </div>
    );
  },
};

export const ErrorMessage: Story = {
  render: () => (
    <div style={{ width: 400 }}>
      <Stepper
        steps={[
          { key: 'connect', label: 'Connecting' },
          { key: 'scan', label: 'Scanning' },
          {
            key: 'query',
            label: 'Querying',
            error: 'Connection timeout — retrying in 5s',
          },
          { key: 'ready', label: 'Ready' },
        ]}
        active={2}
      />
    </div>
  ),
};

export const Flourish: Story = {
  name: 'Final Step Flourish',
  render: () => (
    <div style={{ width: 400 }}>
      <Stepper steps={PIPELINE_STEPS} active={3} />
    </div>
  ),
};

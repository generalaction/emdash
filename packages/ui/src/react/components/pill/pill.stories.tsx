import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import { Pill, type PillTone } from './pill';

const TONES: Array<{ label: string; tone: PillTone }> = [
  { label: 'Neutral', tone: 'neutral' },
  { label: 'Success', tone: 'success' },
  { label: 'Warning', tone: 'warning' },
  { label: 'Error', tone: 'error' },
  { label: 'Info', tone: 'info' },
];

const meta: Meta<typeof Pill> = {
  title: 'Components/Pill',
  component: Pill,
  parameters: { layout: 'centered' },
  args: {
    tone: 'neutral',
    dot: true,
    children: 'Status',
  },
};
export default meta;
type Story = StoryObj<typeof Pill>;

export const Default: Story = {
  name: 'Default',
};

export const Tones: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
      {TONES.map(({ label, tone }) => (
        <div
          key={tone}
          style={{
            display: 'flex',
            minWidth: '6rem',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Pill tone={tone} dot>
            {label}
          </Pill>
          <span
            style={{
              fontSize: 'var(--em-text-xs)',
              color: 'var(--em-foreground-muted)',
            }}
          >
            {tone}
          </span>
        </div>
      ))}
    </div>
  ),
};

export const WithoutDot: Story = {
  name: 'Without dot',
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      {TONES.map(({ label, tone }) => (
        <Pill key={tone} tone={tone}>
          {label}
        </Pill>
      ))}
    </div>
  ),
};

export const PulsingDot: Story = {
  name: 'Pulsing dot',
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      {TONES.map(({ label, tone }) => (
        <Pill key={tone} tone={tone} dot pulsing>
          {label}
        </Pill>
      ))}
    </div>
  ),
};

/** Truncation is semantic; margin is caller-owned through the documented root seam. */
export const TruncatedWithSxOverride: Story = {
  render: () => (
    <div style={{ width: '10rem', overflow: 'hidden' }}>
      <Pill truncate className={sx({ marginInline: tokens.space.step2 })}>
        A very long collection status that does not fit
      </Pill>
    </div>
  ),
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { UpdateCard, type UpdateStatus } from './update-card';
import * as s from '@react/story-layout.css';

const meta: Meta<typeof UpdateCard> = {
  title: 'Components/UpdateCard',
  component: UpdateCard,
  parameters: { layout: 'centered' },
  args: {
    currentVersion: '1.4.2',
    appName: 'Emdash',
  },
};
export default meta;
type Story = StoryObj<typeof UpdateCard>;

export const Idle: Story = {
  name: 'Idle — up to date',
  args: { status: { kind: 'idle' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const NotAvailable: Story = {
  name: 'Not available — up to date (explicit)',
  args: { status: { kind: 'not-available' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const Checking: Story = {
  name: 'Checking for updates',
  args: { status: { kind: 'checking' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const Available: Story = {
  name: 'Update available',
  args: { status: { kind: 'available', version: '1.5.0' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const AvailableNoVersion: Story = {
  name: 'Update available (no version info)',
  args: { status: { kind: 'available' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const Downloading0: Story = {
  name: 'Downloading — 0%',
  args: { status: { kind: 'downloading', percent: 0 } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const Downloading42: Story = {
  name: 'Downloading — 42%',
  args: { status: { kind: 'downloading', percent: 42 } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const Downloading100: Story = {
  name: 'Downloading — 100%',
  args: { status: { kind: 'downloading', percent: 100 } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const Downloaded: Story = {
  name: 'Downloaded — ready to restart',
  args: { status: { kind: 'downloaded' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const Installing: Story = {
  name: 'Installing',
  args: { status: { kind: 'installing' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const ErrorState: Story = {
  name: 'Error',
  args: { status: { kind: 'error', message: 'Network request failed' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

export const NoVersion: Story = {
  name: 'No version yet',
  args: { currentVersion: undefined, status: { kind: 'idle' } },
  render: (args) => <UpdateCard {...args} className={s.w96} />,
};

// ── All states grid ───────────────────────────────────────────────────────────

const ALL_STATUSES: Array<{ label: string; status: UpdateStatus }> = [
  { label: 'idle', status: { kind: 'idle' } },
  { label: 'not-available', status: { kind: 'not-available' } },
  { label: 'checking', status: { kind: 'checking' } },
  { label: 'available', status: { kind: 'available', version: '1.5.0' } },
  { label: 'downloading 0%', status: { kind: 'downloading', percent: 0 } },
  { label: 'downloading 60%', status: { kind: 'downloading', percent: 60 } },
  { label: 'downloading 100%', status: { kind: 'downloading', percent: 100 } },
  { label: 'downloaded', status: { kind: 'downloaded' } },
  { label: 'installing', status: { kind: 'installing' } },
  { label: 'error', status: { kind: 'error' } },
];

export const AllStates: Story = {
  name: 'All states',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '28rem' }}>
      {ALL_STATUSES.map(({ label, status }) => (
        <div key={label}>
          <p
            style={{
              fontSize: 'var(--em-text-xs)',
              color: 'var(--em-foreground-muted)',
              marginBottom: '0.375rem',
              fontFamily: 'var(--em-font-mono)',
            }}
          >
            {label}
          </p>
          <UpdateCard currentVersion="1.4.2" appName="Emdash" status={status} />
        </div>
      ))}
    </div>
  ),
};

// ── Interactive live walkthrough ──────────────────────────────────────────────

const STAGES: UpdateStatus[] = [
  { kind: 'idle' },
  { kind: 'checking' },
  { kind: 'available', version: '1.5.0' },
  { kind: 'downloading', percent: 0 },
  { kind: 'downloading', percent: 25 },
  { kind: 'downloading', percent: 60 },
  { kind: 'downloading', percent: 90 },
  { kind: 'downloading', percent: 100 },
  { kind: 'downloaded' },
  { kind: 'installing' },
  { kind: 'idle' },
];

function InteractiveDemo() {
  const [stageIdx, setStageIdx] = React.useState(0);
  const status = STAGES[stageIdx] ?? { kind: 'idle' };
  const isLast = stageIdx >= STAGES.length - 1;

  function advance() {
    setStageIdx((i) => Math.min(i + 1, STAGES.length - 1));
  }

  function reset() {
    setStageIdx(0);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '28rem' }}>
      <UpdateCard
        currentVersion="1.4.2"
        appName="Emdash"
        status={status}
        onCheck={advance}
        onDownload={advance}
        onInstall={advance}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          type="button"
          onClick={advance}
          disabled={isLast}
          style={{
            fontSize: 'var(--em-text-xs)',
            color: isLast ? 'var(--em-foreground-muted)' : 'var(--em-foreground)',
            background: 'none',
            border: '1px solid var(--em-border)',
            borderRadius: 'var(--em-radius-sm)',
            padding: '0.25rem 0.75rem',
            cursor: isLast ? 'not-allowed' : 'pointer',
          }}
        >
          Next stage →
        </button>
        <button
          type="button"
          onClick={reset}
          style={{
            fontSize: 'var(--em-text-xs)',
            color: 'var(--em-foreground-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
        <span
          style={{
            fontSize: 'var(--em-text-xs)',
            color: 'var(--em-foreground-muted)',
            fontFamily: 'var(--em-font-mono)',
          }}
        >
          {stageIdx + 1} / {STAGES.length} — {status.kind}
        </span>
      </div>
    </div>
  );
}

export const Interactive: Story = {
  name: 'Interactive walkthrough',
  render: () => <InteractiveDemo />,
};

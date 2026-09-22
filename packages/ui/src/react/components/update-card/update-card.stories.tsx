import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { UpdateCard, type UpdateStatus } from './update-card';

const meta = {
  title: 'Components/UpdateCard',
  component: UpdateCard,
  parameters: { layout: 'centered' },
  args: {
    currentVersion: '1.2.5',
    appName: 'Emdash',
    status: {
      type: 'update-download-available',
      version: '1.2.6',
      size: 0,
      onDownload: async () => {},
    },
    onCheckForUpdates: async () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 'min(48rem, calc(100vw - 6rem))' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpdateCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Downloading: Story = {
  args: { status: { type: 'update-downloading', version: '1.2.6', progress: 42 } },
};

export const WaitingForProgress: Story = {
  args: { status: { type: 'update-downloading', version: '1.2.6' } },
};

export const Restarting: Story = {
  args: { status: { type: 'update-installing' } },
};

export const AllStates: Story = {
  render: (args) => {
    const states: UpdateStatus[] = [
      { type: 'up-to-date' },
      { type: 'checking' },
      { type: 'update-download-available', version: '1.2.6', size: 0, onDownload: async () => {} },
      { type: 'update-downloading', version: '1.2.6' },
      { type: 'update-downloading', version: '1.2.6', progress: 42 },
      { type: 'update-install-available', onInstall: async () => {} },
      { type: 'update-installing' },
    ];
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        {states.map((status) => (
          <UpdateCard key={JSON.stringify(status)} {...args} status={status} />
        ))}
      </div>
    );
  },
};

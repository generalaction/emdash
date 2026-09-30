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

export const DownloadError: Story = {
  args: {
    error: {
      message:
        'The download was interrupted because the connection was lost. Check your internet connection, then try downloading the update again.',
      details:
        'Version: 1.2.6\nError: net::ERR_CONNECTION_RESET\nThe connection closed while downloading the update archive. The download did not complete, so no update is ready to install.\nYou can keep using the current version of Emdash and retry the download when your connection is restored.',
    },
  },
};

export const LongError: Story = {
  args: {
    error: {
      message:
        'Cannot download the update archive: ' + 'a-long-unbroken-diagnostic-value-'.repeat(12),
    },
  },
};

export const CheckError: Story = {
  args: {
    status: { type: 'up-to-date' },
    error: {
      message:
        'Could not connect to the update server. Check your internet connection and try again.',
    },
  },
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

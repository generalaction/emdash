/** @vitest-environment jsdom */
import { deferred } from '@emdash/shared/testing';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateCard, type UpdateCardProps } from './update-card';

const props: UpdateCardProps = {
  currentVersion: '1.2.5',
  appName: 'Emdash',
  onCheckForUpdates: async () => {},
  status: {
    type: 'update-download-available',
    version: '1.2.6',
    size: 0,
    onDownload: async () => {},
  },
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UpdateCard', () => {
  it('renders an externally started download on mount and after remount', () => {
    const downloading: UpdateCardProps = {
      ...props,
      status: { type: 'update-downloading', version: '1.2.6' },
    };
    let view = render(<UpdateCard {...downloading} />);
    expect((view.getByRole('button', { name: 'Downloading…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    view.unmount();
    view = render(<UpdateCard {...downloading} />);
    expect((view.getByRole('button', { name: 'Downloading…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    view.rerender(
      <UpdateCard
        {...props}
        status={{ type: 'update-downloading', version: '1.2.6', progress: 42 }}
      />
    );
    expect(view.getByRole('button', { name: 'Downloading… 42%' })).toBeTruthy();
  });

  it('stays busy after start acknowledgement and switches to Restart only on downloaded state', async () => {
    const ack = deferred<void>();
    const onDownload = vi.fn(() => ack.promise);
    const view = render(
      <UpdateCard
        {...props}
        status={{ type: 'update-download-available', version: '1.2.6', size: 0, onDownload }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Download' }));
    expect((view.getByRole('button', { name: 'Downloading…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    view.rerender(
      <UpdateCard
        {...props}
        status={{ type: 'update-downloading', version: '1.2.6', progress: 65 }}
      />
    );
    ack.resolve();
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Downloading… 65%' })).toBeTruthy()
    );
    expect(view.queryByRole('button', { name: 'Download' })).toBeNull();
    view.rerender(
      <UpdateCard
        {...props}
        status={{ type: 'update-install-available', onInstall: async () => {} }}
      />
    );
    expect(view.getByRole('button', { name: 'Restart' })).toBeTruthy();
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

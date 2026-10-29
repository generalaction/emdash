import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncJiraButton } from './sync-jira-button';

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('../api/browser/client', () => ({
  getIssuesClient: async () => ({ syncAssignedJiraIssues: mocks.sync }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('project Jira sync action', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.sync.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows counts and every issue error, and allows retry', async () => {
    mocks.sync.mockResolvedValue({
      success: true,
      data: {
        created: 2,
        refreshed: 1,
        skipped: 3,
        failures: [{ identifier: 'ENG-4', message: 'No access' }],
      },
    });
    await act(async () => root.render(<SyncJiraButton projectId="p1" />));
    await act(async () => host.querySelector('button')?.click());
    expect(mocks.sync).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(host.textContent).toContain('2 created, 1 refreshed, 3 skipped');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('ENG-4: No access');
    expect(host.querySelector('button')?.disabled).toBe(false);
  });

  it('shows credential failures', async () => {
    mocks.sync.mockResolvedValue({
      success: false,
      error: {
        type: 'auth_failed',
        message: 'Jira authentication failed. Check your credentials.',
      },
    });
    await act(async () => root.render(<SyncJiraButton projectId="p1" />));
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Check your credentials');
  });

  it('prevents overlapping clicks while the sync is running', async () => {
    let finish!: (value: unknown) => void;
    mocks.sync.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => root.render(<SyncJiraButton projectId="p1" />));
    await act(async () => {
      host.querySelector('button')?.click();
      host.querySelector('button')?.click();
    });
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(host.querySelector('button')?.disabled).toBe(true);
    expect(host.textContent).toContain('Syncing Jira issues');
    await act(async () =>
      finish({ success: true, data: { created: 0, refreshed: 0, skipped: 0, failures: [] } })
    );
  });

  it('shows a transport failure and clears it after a successful retry', async () => {
    mocks.sync
      .mockRejectedValueOnce(new Error('Unable to reach Jira. Check your network connection.'))
      .mockResolvedValueOnce({
        success: true,
        data: { created: 1, refreshed: 0, skipped: 0, failures: [] },
      });
    await act(async () => root.render(<SyncJiraButton projectId="p1" />));
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unable to reach Jira');
    expect(host.querySelector('button')?.disabled).toBe(false);
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('1 created');
  });

  it('respects project availability', async () => {
    await act(async () =>
      root.render(<SyncJiraButton projectId="p1" disabledReason="Reconnect this project" />)
    );
    const button = host.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe('Reconnect this project');
    await act(async () => button?.click());
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canOpenBrowserUrlExternally,
  clearBrowserData,
  confirmClearBrowserStorage,
  openBrowserUrlExternally,
} from './browser-toolbar-actions';

const mocks = vi.hoisted(() => ({
  clearData: vi.fn(),
  openExternal: vi.fn(),
  reload: vi.fn(),
  reloadIgnoringCache: vi.fn(),
  showModal: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: mocks.openExternal,
    },
    browser: {
      clearData: mocks.clearData,
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

function session() {
  return {
    browserId: 'browser-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    partition: 'persist:emdash-browser-project-1-workspace-1-task-1-browser-1',
    currentUrl: 'https://example.com/',
    title: 'Example',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('browser toolbar actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearData.mockResolvedValue({ success: true });
  });

  it('opens only http and https URLs externally', () => {
    openBrowserUrlExternally('example.com');
    openBrowserUrlExternally('javascript:alert(1)');
    openBrowserUrlExternally('about:blank');

    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('reports whether the current URL can be opened externally', () => {
    expect(canOpenBrowserUrlExternally('https://example.com/')).toBe(true);
    expect(canOpenBrowserUrlExternally('localhost:3000')).toBe(true);
    expect(canOpenBrowserUrlExternally('about:blank')).toBe(false);
    expect(canOpenBrowserUrlExternally('javascript:alert(1)')).toBe(false);
  });

  it('clears storage only after explicit modal confirmation and reloads on success', async () => {
    confirmClearBrowserStorage(session(), mocks.reload);

    expect(mocks.showModal).toHaveBeenCalledWith(
      'confirmActionModal',
      expect.objectContaining({
        title: 'Clear browser storage?',
        variant: 'destructive',
        onSuccess: expect.any(Function),
      })
    );
    await mocks.showModal.mock.calls[0][1].onSuccess();

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'storage');
    expect(mocks.reload).toHaveBeenCalledWith();
  });

  it('clears cookies and reloads on success', async () => {
    clearBrowserData(session(), 'cookies', mocks.reload);
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledWith());

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'cookies');
  });

  it('clears the cache and force-reloads on success', async () => {
    clearBrowserData(session(), 'cache', mocks.reloadIgnoringCache);
    await vi.waitFor(() => expect(mocks.reloadIgnoringCache).toHaveBeenCalledWith());

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'cache');
  });

  it('does not reload when clearing cookies fails', async () => {
    mocks.clearData.mockResolvedValue({ success: false });
    clearBrowserData(session(), 'cookies', mocks.reload);
    await vi.waitFor(() => expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'cookies'));

    expect(mocks.reload).not.toHaveBeenCalled();
  });
});

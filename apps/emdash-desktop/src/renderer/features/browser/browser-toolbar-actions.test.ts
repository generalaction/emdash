import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canOpenBrowserUrlExternally,
  clearBrowserCache,
  clearBrowserCookies,
  confirmClearBrowserStorage,
  openBrowserUrlExternally,
} from './browser-toolbar-actions';

const mocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
  clearCookies: vi.fn(),
  clearStorage: vi.fn(),
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
      clearCache: mocks.clearCache,
      clearCookies: mocks.clearCookies,
      clearStorage: mocks.clearStorage,
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
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('browser toolbar actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearCache.mockResolvedValue({ success: true });
    mocks.clearCookies.mockResolvedValue({ success: true });
    mocks.clearStorage.mockResolvedValue({ success: true });
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
    confirmClearBrowserStorage(session(), { reload: mocks.reload } as never);

    expect(mocks.showModal).toHaveBeenCalledWith(
      'confirmActionModal',
      expect.objectContaining({
        title: 'Clear browser storage?',
        variant: 'destructive',
        onSuccess: expect.any(Function),
      })
    );
    await mocks.showModal.mock.calls[0][1].onSuccess();

    expect(mocks.clearStorage).toHaveBeenCalledWith('browser-1');
    expect(mocks.reload).toHaveBeenCalledWith();
  });

  it('clears cookies and reloads on success', async () => {
    clearBrowserCookies(session(), { reload: mocks.reload } as never);
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledWith());

    expect(mocks.clearCookies).toHaveBeenCalledWith('browser-1');
  });

  it('clears the cache and force-reloads on success', async () => {
    clearBrowserCache(session(), { reloadIgnoringCache: mocks.reloadIgnoringCache } as never);
    await vi.waitFor(() => expect(mocks.reloadIgnoringCache).toHaveBeenCalledWith());

    expect(mocks.clearCache).toHaveBeenCalledWith('browser-1');
  });

  it('does not reload when clearing cookies fails', async () => {
    mocks.clearCookies.mockResolvedValue({ success: false });
    clearBrowserCookies(session(), { reload: mocks.reload } as never);
    await vi.waitFor(() => expect(mocks.clearCookies).toHaveBeenCalledWith('browser-1'));

    expect(mocks.reload).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canOpenBrowserUrlExternally,
  captureBrowserScreenshot,
  clearBrowserData,
  confirmClearBrowserStorage,
  openBrowserUrlExternally,
} from './browser-toolbar-actions';

const mocks = vi.hoisted(() => ({
  captureScreenshot: vi.fn(),
  clearData: vi.fn(),
  openExternal: vi.fn(),
  reload: vi.fn(),
  reloadIgnoringCache: vi.fn(),
  showModal: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: mocks.openExternal,
    },
    browser: {
      captureScreenshot: mocks.captureScreenshot,
      clearData: mocks.clearData,
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: mocks.toast,
}));

function session() {
  return {
    browserId: 'browser-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    profileId: 'default',
    partition: 'persist:emdash-browser-profile',
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
    mocks.captureScreenshot.mockResolvedValue({ success: true });
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

  it('captures screenshots and shows feedback on success', async () => {
    await captureBrowserScreenshot(session());

    expect(mocks.captureScreenshot).toHaveBeenCalledWith('browser-1');
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Screenshot copied to clipboard' });
  });

  it('shows feedback when screenshot capture fails', async () => {
    mocks.captureScreenshot.mockResolvedValue({ success: false });
    await captureBrowserScreenshot(session());

    expect(mocks.captureScreenshot).toHaveBeenCalledWith('browser-1');
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Could not capture screenshot',
      variant: 'destructive',
    });
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

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'storage');
    expect(mocks.reload).toHaveBeenCalledWith();
  });

  it('clears cookies and reloads on success', async () => {
    await clearBrowserData(session(), 'cookies', mocks.reload);

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'cookies');
    expect(mocks.reload).toHaveBeenCalledWith();
  });

  it('clears the cache and force-reloads on success', async () => {
    await clearBrowserData(session(), 'cache', mocks.reloadIgnoringCache);

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'cache');
    expect(mocks.reloadIgnoringCache).toHaveBeenCalledWith();
  });

  it('does not reload and shows feedback when clearing cookies fails', async () => {
    mocks.clearData.mockResolvedValue({ success: false });
    await clearBrowserData(session(), 'cookies', mocks.reload);

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'cookies');
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Could not clear browser data',
      description: 'Try again, or reload the browser view manually.',
      variant: 'destructive',
    });
  });

  it('does not reload and shows feedback when clearing browser data rejects', async () => {
    const error = new Error('IPC failed');
    mocks.clearData.mockRejectedValue(error);
    await clearBrowserData(session(), 'cache', mocks.reloadIgnoringCache);

    expect(mocks.clearData).toHaveBeenCalledWith('browser-1', 'cache');
    expect(mocks.reloadIgnoringCache).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Could not clear browser data',
      description: 'IPC failed',
      variant: 'destructive',
    });
  });
});

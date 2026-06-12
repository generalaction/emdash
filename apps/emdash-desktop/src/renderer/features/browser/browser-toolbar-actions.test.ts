import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canOpenBrowserUrlExternally,
  confirmClearBrowserStorage,
  openBrowserUrlExternally,
} from './browser-toolbar-actions';

const mocks = vi.hoisted(() => ({
  clearStorage: vi.fn(),
  openExternal: vi.fn(),
  reload: vi.fn(),
  showModal: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: mocks.openExternal,
    },
    browser: {
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
    profileId: 'default',
    partition: 'persist:emdash-browser-profile-default',
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
});

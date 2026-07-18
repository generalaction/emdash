import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmOpenExternalLink } from './open-external-link';

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  getTaskView: vi.fn(),
  navigationRef: {
    viewId: 'home',
    params: {} as { projectId?: string; taskId?: string },
    key: 'home',
  },
  openExternal: vi.fn(),
  openModal: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@core/features/tasks/browser/stores/task-selectors', () => ({
  getTaskView: mocks.getTaskView,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: mocks.toast,
}));

vi.mock('@renderer/lib/runtime/desktop-host-client', () => ({
  rpc: {
    app: {
      clipboardWriteText: mocks.clipboardWriteText,
      openExternal: mocks.openExternal,
    },
  },
}));

vi.mock('@renderer/lib/modal/api', () => ({
  openModal: mocks.openModal,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'home',
      currentRef: mocks.navigationRef,
    },
  },
}));

type ExternalLinkModalArgs = {
  url: string;
  onCopy: () => Promise<boolean>;
};

function getModalArgs(): ExternalLinkModalArgs {
  return mocks.openModal.mock.calls[0]?.[1] as ExternalLinkModalArgs;
}

describe('confirmOpenExternalLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clipboardWriteText.mockResolvedValue({ success: true });
    mocks.navigationRef.viewId = 'home';
    mocks.navigationRef.params = {};
    mocks.openModal.mockResolvedValue({
      success: false,
      error: { type: 'modal_dismissed', reason: 'explicit' },
    });
  });

  it('copies the normalized link and reports success', async () => {
    confirmOpenExternalLink('https://example.com/docs).');

    const args = getModalArgs();
    expect(args.url).toBe('https://example.com/docs');

    await expect(args.onCopy()).resolves.toBe(true);

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('https://example.com/docs');
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Link copied' });
  });

  it('reports when the native clipboard write fails', async () => {
    mocks.clipboardWriteText.mockResolvedValue({ success: false, error: 'Clipboard unavailable' });

    confirmOpenExternalLink('https://example.com/docs');
    await expect(getModalArgs().onCopy()).resolves.toBe(false);

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Copy failed',
      description: 'The link could not be copied to the clipboard.',
      variant: 'destructive',
    });
  });

  it('reports when the clipboard request rejects', async () => {
    mocks.clipboardWriteText.mockRejectedValue(new Error('IPC unavailable'));

    confirmOpenExternalLink('https://example.com/docs');

    await expect(getModalArgs().onCopy()).resolves.toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Copy failed',
      description: 'The link could not be copied to the clipboard.',
      variant: 'destructive',
    });
  });

  it('opens the external browser after the modal completes with that choice', async () => {
    mocks.openModal.mockResolvedValue({
      success: true,
      data: 'external-browser',
    });
    mocks.openExternal.mockResolvedValue(undefined);

    confirmOpenExternalLink('https://example.com/docs');

    await vi.waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/docs');
    });
  });

  it('opens the link in the active Emdash task after that choice completes', async () => {
    const taskView = {
      paneLayout: { open: vi.fn() },
      setFocusedRegion: vi.fn(),
    };
    mocks.navigationRef.viewId = 'task';
    mocks.navigationRef.params = { projectId: 'project-1', taskId: 'task-1' };
    mocks.getTaskView.mockReturnValue(taskView);
    mocks.openModal.mockResolvedValue({
      success: true,
      data: 'emdash-browser',
    });

    confirmOpenExternalLink('https://example.com/docs');

    await vi.waitFor(() => {
      expect(taskView.paneLayout.open).toHaveBeenCalledWith('browser', {
        initialUrl: 'https://example.com/docs',
      });
      expect(taskView.setFocusedRegion).toHaveBeenCalledWith('main');
    });
  });

  it('does nothing when the modal is dismissed', async () => {
    confirmOpenExternalLink('https://example.com/docs');

    await Promise.resolve();

    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmOpenExternalLink } from './open-external-link';

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  getTaskView: vi.fn(),
  openExternal: vi.fn(),
  showModal: vi.fn(),
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

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'home',
      viewParamsStore: { task: undefined },
    },
  },
}));

type ExternalLinkModalArgs = {
  url: string;
  onCopy: () => Promise<boolean>;
};

function getModalArgs(): ExternalLinkModalArgs {
  return mocks.showModal.mock.calls[0]?.[1] as ExternalLinkModalArgs;
}

describe('confirmOpenExternalLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clipboardWriteText.mockResolvedValue({ success: true });
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
});

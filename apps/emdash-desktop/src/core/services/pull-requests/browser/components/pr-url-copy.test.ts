import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyPrUrl } from './pr-url-copy';

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock('@emdash/ui/react/primitives', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: mocks.toast,
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  copyTextToClipboard: mocks.clipboardWriteText,
}));

describe('copyPrUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clipboardWriteText.mockResolvedValue({ success: true });
  });

  it('copies the PR URL through the app clipboard service and reports success', async () => {
    await expect(copyPrUrl('https://github.com/emdash/emdash/pull/123')).resolves.toBe(true);

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith(
      'https://github.com/emdash/emdash/pull/123'
    );
    expect(mocks.toast).toHaveBeenCalledWith('PR URL copied');
  });

  it('uses MR terminology for GitLab clipboard success and failure', async () => {
    const url = 'https://gitlab.com/acme/app/-/merge_requests/42';
    await expect(copyPrUrl(url, 'gitlab')).resolves.toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith('MR URL copied');
    mocks.clipboardWriteText.mockResolvedValueOnce({ success: false });
    await expect(copyPrUrl(url, 'gitlab')).resolves.toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith('Copy failed', {
      description: 'The MR URL could not be copied to the clipboard.',
    });
  });

  it('reports when the clipboard service returns a failure', async () => {
    mocks.clipboardWriteText.mockResolvedValue({
      success: false,
      error: 'Clipboard unavailable',
    });

    await expect(copyPrUrl('https://github.com/emdash/emdash/pull/123')).resolves.toBe(false);

    expect(mocks.toast.error).toHaveBeenCalledWith('Copy failed', {
      description: 'The PR URL could not be copied to the clipboard.',
    });
  });

  it('reports when the clipboard request rejects', async () => {
    mocks.clipboardWriteText.mockRejectedValue(new Error('IPC unavailable'));

    await expect(copyPrUrl('https://github.com/emdash/emdash/pull/123')).resolves.toBe(false);

    expect(mocks.toast.error).toHaveBeenCalledWith('Copy failed', {
      description: 'The PR URL could not be copied to the clipboard.',
    });
  });
});

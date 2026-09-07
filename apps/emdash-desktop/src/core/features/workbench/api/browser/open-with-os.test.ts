import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { openWithOS } from './open-with-os';

const mocks = vi.hoisted(() => ({
  openPath: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => ({ openPath: mocks.openPath }),
}));

vi.mock('@emdash/ui/react/primitives', () => ({
  toast: { error: mocks.toastError },
}));

describe('openWithOS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openPath.mockResolvedValue({ success: true });
  });

  it('opens a local HostFileRef without discarding its host identity', async () => {
    const ref = hostFileRefFromNativePath('/tmp/photo.png');
    await openWithOS(ref);

    expect(mocks.openPath).toHaveBeenCalledWith({ ref });
  });

  it('surfaces an OS-open failure as a toast', async () => {
    mocks.openPath.mockResolvedValue({ success: false, error: 'no handler' });

    await openWithOS(hostFileRefFromNativePath('/tmp/strange.bin'));

    expect(mocks.toastError).toHaveBeenCalledWith('Could not open /tmp/strange.bin: no handler');
  });

  it('never passes a remote file to the desktop OS opener', async () => {
    await openWithOS(hostFileRefFromNativePath('/tmp/remote.pdf', 'ssh-1'));

    expect(mocks.openPath).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Could not open /tmp/remote.pdf: default applications are only available for local files'
    );
  });

  it.each([
    String.raw`C:\Users\Jane Doe\report #100%.pdf`,
    String.raw`C:\資料\résumé.pdf`,
    String.raw`\\server\share\Team Files\report #100%.pdf`,
  ])('preserves Windows path spelling at the local-host boundary: %s', async (path) => {
    const ref = hostFileRefFromNativePath(path);
    await openWithOS(ref);

    expect(mocks.openPath).toHaveBeenCalledWith({ ref });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});

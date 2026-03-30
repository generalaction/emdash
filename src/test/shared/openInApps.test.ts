import { describe, expect, it } from 'vitest';
import {
  OPEN_IN_APPS,
  getAppById,
  isOpenInAppSupportedForWorkspace,
} from '../../shared/openInApps';

describe('isOpenInAppSupportedForWorkspace', () => {
  it('keeps all apps available for local workspaces', () => {
    const localAppIds = OPEN_IN_APPS.filter((app) =>
      isOpenInAppSupportedForWorkspace(app, false)
    ).map((app) => app.id);

    expect(localAppIds).toEqual(OPEN_IN_APPS.map((app) => app.id));
    expect(localAppIds).toContain('zed');
  });

  it('filters out apps without remote support for SSH workspaces', () => {
    const remoteAppIds = OPEN_IN_APPS.filter((app) =>
      isOpenInAppSupportedForWorkspace(app, true)
    ).map((app) => app.id);

    expect(remoteAppIds).not.toContain('zed');
    expect(remoteAppIds).toEqual(
      expect.arrayContaining(['cursor', 'vscode', 'terminal', 'warp', 'iterm2', 'ghostty', 'kitty'])
    );
    expect(remoteAppIds).not.toContain('vscodium');
  });

  it('treats Zed as local-only until remote support exists', () => {
    const zed = getAppById('zed');

    expect(zed).toBeDefined();
    expect(isOpenInAppSupportedForWorkspace(zed!, true)).toBe(false);
    expect(isOpenInAppSupportedForWorkspace(zed!, false)).toBe(true);
  });
});

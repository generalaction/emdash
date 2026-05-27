import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { prepareLocalOpenCodeThemeEnv, prepareSshOpenCodeThemeEnv } from './opencode-theme-state';

const sshFsMock = vi.hoisted(() => ({
  write: vi.fn(),
}));

vi.mock('electron', () => ({
  nativeTheme: {
    shouldUseDarkColors: true,
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn().mockResolvedValue('emdark'),
  },
}));

vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: vi.fn(function SshFileSystem() {
    return {
      write: sshFsMock.write,
    };
  }),
}));

describe('opencode theme state', () => {
  let previousXdgStateHome: string | undefined;
  const tempDirs: string[] = [];

  beforeEach(() => {
    previousXdgStateHome = process.env.XDG_STATE_HOME;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes local opencode state under the existing XDG state directory without returning env', async () => {
    const xdgStateHome = await mkdtemp(join(tmpdir(), 'emdash-opencode-state-'));
    tempDirs.push(xdgStateHome);
    process.env.XDG_STATE_HOME = xdgStateHome;

    const result = await prepareLocalOpenCodeThemeEnv('opencode');

    await expect(readFile(join(xdgStateHome, 'opencode', 'kv.json'), 'utf8')).resolves.toBe(
      '{\n  "theme_mode_lock": "dark"\n}\n'
    );
    expect(result).toBeUndefined();
  });

  it('writes SSH opencode state under the remote XDG state directory without returning env', async () => {
    sshFsMock.write.mockResolvedValue({ success: true, bytesWritten: 0 });
    const profile: RemoteShellProfile = {
      shell: '/bin/sh',
      env: {
        HOME: '/home/bubu',
        XDG_STATE_HOME: '/state/bubu/',
      },
    };

    const result = await prepareSshOpenCodeThemeEnv({
      providerId: 'opencode',
      profile,
      proxy: {} as SshClientProxy,
    });

    expect(result).toBeUndefined();
    expect(sshFsMock.write).toHaveBeenCalledWith(
      '/state/bubu/opencode/kv.json',
      '{\n  "theme_mode_lock": "dark"\n}\n'
    );
  });

  it('falls back to the remote home XDG state path when SSH has no XDG override', async () => {
    sshFsMock.write.mockResolvedValue({ success: true, bytesWritten: 0 });
    const profile: RemoteShellProfile = {
      shell: '/bin/sh',
      env: {
        HOME: '/home/bubu/',
      },
    };

    await prepareSshOpenCodeThemeEnv({
      providerId: 'opencode',
      profile,
      proxy: {} as SshClientProxy,
    });

    expect(sshFsMock.write).toHaveBeenCalledWith(
      '/home/bubu/.local/state/opencode/kv.json',
      '{\n  "theme_mode_lock": "dark"\n}\n'
    );
  });
});

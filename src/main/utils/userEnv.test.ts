import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

const { ensureUserBinDirsInPath, ensureWindowsNpmGlobalBinInPath, resolveUserEnv } = await import(
  './userEnv'
);

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

describe('ensureUserBinDirsInPath', () => {
  it('prepends existing user bin directories to process PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-user-bin-'));
    process.env.PATH = '/usr/bin';

    const added = ensureUserBinDirsInPath([dir]);

    expect(added).toEqual([dir]);
    expect(process.env.PATH?.split(path.delimiter).slice(0, 2)).toEqual([dir, '/usr/bin']);
  });

  it('does not duplicate existing path entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-user-bin-'));
    process.env.PATH = [dir, '/usr/bin'].join(path.delimiter);

    const added = ensureUserBinDirsInPath([dir]);

    expect(added).toEqual([]);
    expect(process.env.PATH).toBe([dir, '/usr/bin'].join(path.delimiter));
  });
});

describe('ensureWindowsNpmGlobalBinInPath', () => {
  it('uses APPDATA case-insensitively when prepending npm global bin', () => {
    const env: NodeJS.ProcessEnv = {
      appdata: 'C:\\Users\\test\\AppData\\Roaming',
      Path: 'C:\\Windows\\System32',
    };

    const added = ensureWindowsNpmGlobalBinInPath(env);

    expect(added).toBe('C:\\Users\\test\\AppData\\Roaming\\npm');
    expect(env.Path).toBe('C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Windows\\System32');
  });
});

describe('resolveUserEnv (AppImage env scrub)', () => {
  const SCRUBBED_KEYS = [
    'APPIMAGE',
    'APPDIR',
    'ARGV0',
    'OWD',
    'CHROME_DESKTOP',
    'GSETTINGS_SCHEMA_DIR',
  ] as const;
  const PATH_LIKE_KEYS = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS'] as const;
  const savedEnv: Partial<
    Record<(typeof SCRUBBED_KEYS)[number] | (typeof PATH_LIKE_KEYS)[number], string | undefined>
  > = {};

  beforeEach(() => {
    execSyncMock.mockReset();
    execSyncMock.mockReturnValue('');
    for (const key of [...SCRUBBED_KEYS, ...PATH_LIKE_KEYS]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('strips AppImage runtime vars and /tmp/.mount_* path entries from the probe shell env and final PATH', async () => {
    execSyncMock.mockReturnValue('PATH=/usr/local/bin:/usr/bin\n');
    process.env.APPIMAGE = '/home/user/emdash.AppImage';
    process.env.APPDIR = '/tmp/.mount_emdashTest';
    process.env.ARGV0 = '/home/user/emdash.AppImage';
    process.env.OWD = '/home/user';
    process.env.CHROME_DESKTOP = 'emdash.desktop';
    process.env.GSETTINGS_SCHEMA_DIR = '/tmp/.mount_emdashTest/usr/share/glib-2.0/schemas';
    process.env.PATH = '/tmp/.mount_emdashTest/usr/bin:/usr/local/bin:/usr/bin';
    process.env.LD_LIBRARY_PATH = '/tmp/.mount_emdashTest/usr/lib:/usr/lib';
    process.env.XDG_DATA_DIRS = '/tmp/.mount_emdashTest/usr/share:/usr/local/share:/usr/share';

    await resolveUserEnv();

    expect(execSyncMock).toHaveBeenCalledTimes(1);
    const opts = execSyncMock.mock.calls[0]?.[1] as { env?: NodeJS.ProcessEnv } | undefined;
    expect(opts?.env).toBeDefined();
    const probeEnv = opts!.env!;
    for (const key of SCRUBBED_KEYS) {
      expect(probeEnv[key]).toBeUndefined();
    }
    for (const key of PATH_LIKE_KEYS) {
      expect(probeEnv[key] ?? '').not.toContain('/tmp/.mount_');
    }
    expect(process.env.PATH ?? '').not.toContain('/tmp/.mount_');
    // Helper hint vars must still be set so oh-my-zsh / tmux plugins stay quiet.
    expect(probeEnv.DISABLE_AUTO_UPDATE).toBe('true');
    expect(probeEnv.ZSH_TMUX_AUTOSTART).toBe('false');
  });
});

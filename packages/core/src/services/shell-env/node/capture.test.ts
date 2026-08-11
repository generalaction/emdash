import { describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const userInfoMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('node:os', () => ({
  default: {
    userInfo: userInfoMock,
  },
}));

const { captureShellEnv, parseEnvOutput, resolveLoginShell } = await import('./capture');

describe('parseEnvOutput', () => {
  it('parses shell env output and ignores invalid keys', () => {
    expect(parseEnvOutput('PATH=/usr/bin\nBAD-KEY=value\nFOO=a=b\n')).toEqual({
      PATH: '/usr/bin',
      FOO: 'a=b',
    });
  });
});

describe('resolveLoginShell', () => {
  it('falls back from SHELL to the account shell', () => {
    userInfoMock.mockReturnValueOnce({ shell: '/bin/fish' });
    existsSyncMock.mockImplementation((candidate) => candidate === '/bin/fish');

    expect(resolveLoginShell({ SHELL: '/missing' })).toBe('/bin/fish');
  });
});

describe('captureShellEnv', () => {
  it('captures login-shell env with guard variables', async () => {
    userInfoMock.mockReturnValueOnce({ shell: '/bin/bash' });
    existsSyncMock.mockReturnValue(true);
    spawnSyncMock.mockReturnValueOnce({
      error: undefined,
      status: 0,
      stderr: '',
      stdout: 'PATH=/usr/local/bin:/usr/bin\nFOO=bar\n',
    });

    const result = await captureShellEnv({
      baseEnv: { SHELL: '/bin/bash', PATH: '/usr/bin' },
      now: () => 123,
    });

    expect(result).toEqual({
      success: true,
      data: {
        env: { PATH: '/usr/local/bin:/usr/bin', FOO: 'bar' },
        source: 'login-shell',
        capturedAt: 123,
      },
    });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/bin/bash',
      ['-ilc', 'env'],
      expect.objectContaining({
        detached: true,
        env: expect.objectContaining({
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
          ZSH_TMUX_AUTOSTARTED: 'true',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  });

  it('returns a capture error when the shell exits non-zero', async () => {
    userInfoMock.mockReturnValueOnce({ shell: '/bin/bash' });
    existsSyncMock.mockReturnValue(true);
    spawnSyncMock.mockReturnValueOnce({
      error: undefined,
      status: 2,
      stderr: 'broken rc file',
      stdout: '',
    });

    const result = await captureShellEnv({ baseEnv: { SHELL: '/bin/bash' } });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'capture-failed',
        shell: '/bin/bash',
        message: 'broken rc file',
      },
    });
  });
});

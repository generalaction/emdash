import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const userInfoMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  statSync: vi.fn(() => ({ isDirectory: () => false })),
}));

vi.mock('node:os', () => ({
  default: {
    homedir: () => '/home/test',
    userInfo: userInfoMock,
  },
}));

const { createShellEnvManager } = await import('./manager');

beforeEach(() => {
  spawnSyncMock.mockReset();
  existsSyncMock.mockReset();
  userInfoMock.mockReset();
  userInfoMock.mockReturnValue({ shell: '/bin/bash' });
  existsSyncMock.mockReturnValue(true);
});

describe('createShellEnvManager', () => {
  it('coalesces concurrent refreshes', async () => {
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stderr: '',
      stdout: 'PATH=/usr/local/bin\nFOO=bar\n',
    });
    const target: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const manager = createShellEnvManager({
      target,
      baseEnvForProbe: () => ({ SHELL: '/bin/bash', PATH: '/usr/bin' }),
    });

    await Promise.all([manager.refresh(), manager.refresh()]);

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(target.FOO).toBe('bar');
    expect(target.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(manager.getUserShellEnv()).toMatchObject({
      FOO: 'bar',
      PATH: '/usr/local/bin:/usr/bin',
    });
  });

  it('keeps runtime controls in the host env but excludes them from the user snapshot', async () => {
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stderr: '',
      stdout: 'PATH=/shell/bin\nUSER_VALUE=kept\n',
    });
    const target: NodeJS.ProcessEnv = {
      PATH: '/worker/bin',
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
    };
    const manager = createShellEnvManager({ target });

    await manager.refresh();

    expect(target.NODE_ENV).toBe('production');
    expect(target.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(manager.getUserShellEnv()).toEqual({
      PATH: '/shell/bin:/worker/bin',
      USER_VALUE: 'kept',
    });
  });

  it('preserves a runtime-named variable when the login shell explicitly exports it', async () => {
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stderr: '',
      stdout: 'PATH=/shell/bin\nNODE_ENV=development\n',
    });
    const target: NodeJS.ProcessEnv = { PATH: '/worker/bin', NODE_ENV: 'production' };
    const manager = createShellEnvManager({ target });

    await manager.refresh();

    expect(target.NODE_ENV).toBe('production');
    expect(manager.getUserShellEnv().NODE_ENV).toBe('development');
  });

  it('logs and keeps the existing env when capture fails', async () => {
    const warn = vi.fn();
    spawnSyncMock.mockReturnValue({
      error: new Error('spawn failed'),
      status: null,
      stderr: '',
      stdout: '',
    });
    const target: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const manager = createShellEnvManager({
      target,
      baseEnvForProbe: () => ({ SHELL: '/bin/bash', PATH: '/probe/bin' }),
      logger: { warn },
    });

    await expect(manager.refresh()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      '[shell-env] Failed to resolve login-shell env',
      expect.objectContaining({ shell: '/bin/bash', error: 'spawn failed' })
    );
    expect(target).toEqual({ PATH: '/usr/bin' });
  });
});

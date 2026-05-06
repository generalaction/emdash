import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSpawnOptions } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import {
  classifyInstallCommandFailure,
  createSshInstallCommandRunner,
  runLocalInstallCommand,
} from './install-runner';

const mocks = vi.hoisted(() => ({
  openSsh2Pty: vi.fn(),
  spawnLocalPty: vi.fn(),
  ensureUserBinDirsInPath: vi.fn(),
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty: mocks.openSsh2Pty,
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty: mocks.spawnLocalPty,
}));

vi.mock('@main/utils/userEnv', () => ({
  ensureUserBinDirsInPath: mocks.ensureUserBinDirsInPath,
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalEnv = { ...process.env };

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

function createSuccessfulPty(): Pty {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn((handler) => handler({ exitCode: 0 })),
  };
}

beforeEach(() => {
  mocks.spawnLocalPty.mockReturnValue(createSuccessfulPty());
  mocks.openSsh2Pty.mockResolvedValue({ success: true, data: createSuccessfulPty() });
});

afterEach(() => {
  process.env = { ...originalEnv };
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
  vi.clearAllMocks();
});

describe('classifyInstallCommandFailure', () => {
  it('summarizes permission errors from npm global installs', () => {
    expect(
      classifyInstallCommandFailure({
        exitCode: 243,
        output:
          '\u001b[1mnpm\u001b[22m \u001b[31merror\u001b[39m code EACCES\nnpm error path /usr/lib/node_modules/@openai\npermission denied',
      })
    ).toEqual({
      type: 'permission-denied',
      exitCode: 243,
      output:
        'npm error code EACCES\nnpm error path /usr/lib/node_modules/@openai\npermission denied',
      message: 'User does not have sufficient permissions.',
    });
  });

  it('returns command-failed for non-permission failures', () => {
    expect(
      classifyInstallCommandFailure({
        exitCode: 1,
        output: 'network unavailable',
      })
    ).toEqual({
      type: 'command-failed',
      exitCode: 1,
      output: 'network unavailable',
      message: 'Install command failed.',
    });
  });
});

describe('runLocalInstallCommand', () => {
  it('runs Windows installs through the local PTY platform resolver', async () => {
    setPlatform('win32');
    delete process.env.SHELL;
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const result = await runLocalInstallCommand('npm install -g @openai/codex');

    expect(result.success).toBe(true);
    expect(mocks.spawnLocalPty).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'C:\\Windows\\System32\\cmd.exe',
        args: ['/d', '/s', '/c', 'npm install -g @openai/codex'],
        cwd: expect.any(String),
      } satisfies Partial<LocalSpawnOptions>)
    );
  });
});

describe('createSshInstallCommandRunner', () => {
  it('runs remote installs through the captured remote shell profile', async () => {
    const proxy = {
      client: {},
      getRemoteShellProfile: vi.fn(async () => ({
        shell: '/bin/zsh',
        env: {
          PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
        },
      })),
    };
    const runner = createSshInstallCommandRunner(proxy as never);

    const result = await runner('npm install -g @anthropic-ai/claude-code');

    expect(result.success).toBe(true);
    expect(proxy.getRemoteShellProfile).toHaveBeenCalledWith();
    expect(mocks.openSsh2Pty).toHaveBeenCalledWith(
      proxy.client,
      expect.objectContaining({
        command:
          "'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; npm install -g @anthropic-ai/claude-code'",
      })
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  buildRemoteShellCommand,
  FALLBACK_REMOTE_SHELL_PROFILE,
  includeRemoteUserBinDirs,
  normalizeRemoteShell,
  resolveRemoteHome,
  type RemoteShellProfile,
} from './remote-shell-profile';

function makeCtx(stdout: string): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn().mockResolvedValue({ stdout, stderr: '' }),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;
}

describe('remote shell profile command building', () => {
  it('runs commands through the captured remote shell and exports captured PATH', () => {
    const profile: RemoteShellProfile = {
      shell: '/bin/zsh',
      env: {
        PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
        NVM_DIR: '/Users/jona/.nvm',
      },
    };

    const command = buildRemoteShellCommand(profile, 'which claude');

    expect(command).toBe(
      `"/bin/zsh" -lc "export PATH='/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'; export NVM_DIR='/Users/jona/.nvm'; which claude"`
    );
  });

  it('lets explicit command env override captured profile env', () => {
    const profile: RemoteShellProfile = {
      shell: '/bin/zsh',
      env: {
        PATH: '/captured/bin:/usr/bin',
        FOO: 'captured',
      },
    };

    const command = buildRemoteShellCommand(profile, 'node --version', {
      PATH: '/task/bin:/usr/bin',
      FOO: 'task',
    });

    expect(command).toContain("export PATH='/captured/bin:/usr/bin'");
    expect(command).toContain("export PATH='/task/bin:/usr/bin'");
    expect(command.indexOf('/captured/bin')).toBeLessThan(command.indexOf('/task/bin'));
    expect(command).toContain("export FOO='task'; node --version");
  });

  it('adds ~/.local/bin to captured remote PATH', () => {
    expect(
      includeRemoteUserBinDirs({
        HOME: '/root',
        PATH: '/usr/local/bin:/usr/bin',
      })
    ).toEqual({
      HOME: '/root',
      PATH: '/root/.local/bin:/usr/local/bin:/usr/bin',
    });
  });

  it('uses /bin/sh without login flags for the fallback profile', () => {
    const command = buildRemoteShellCommand(FALLBACK_REMOTE_SHELL_PROFILE, 'which claude');

    expect(command).toBe(`"/bin/sh" -c "which claude"`);
  });

  it('filters volatile and invalid environment variables from command exports', () => {
    const command = buildRemoteShellCommand(
      {
        shell: '/bin/zsh',
        env: {
          PATH: '/usr/bin',
          PWD: '/tmp',
          'BAD-NAME': 'nope',
          GOOD_NAME: 'value',
        },
      },
      'env',
      {
        SHLVL: '2',
        ALSO_GOOD: 'yes',
      }
    );

    expect(command).toBe(
      `"/bin/zsh" -lc "export PATH='/usr/bin'; export GOOD_NAME='value'; export ALSO_GOOD='yes'; env"`
    );
  });

  it('falls back to /bin/sh when the remote shell is empty or not absolute', () => {
    expect(normalizeRemoteShell('')).toBe('/bin/sh');
    expect(normalizeRemoteShell('zsh')).toBe('/bin/sh');
    expect(normalizeRemoteShell('/bin/zsh\n')).toBe('/bin/zsh');
  });

  it('falls back to /bin/sh for unsupported remote shells', () => {
    expect(normalizeRemoteShell('/usr/local/bin/fish')).toBe('/bin/sh');
    expect(buildRemoteShellCommand({ shell: '/usr/local/bin/fish', env: {} }, 'echo ok')).toBe(
      `"/bin/sh" -c "echo ok"`
    );
  });

  it('escapes outer double-quote metacharacters while preserving the inner shell script', () => {
    const command = buildRemoteShellCommand(
      {
        shell: '/usr/local/bin/fish',
        env: {
          VALUE: `a "quoted" $value`,
        },
      },
      `printf '%s\\n' "$VALUE"`
    );

    expect(command).toBe(
      `"/bin/sh" -c "export VALUE='a \\"quoted\\" \\$value'; printf '%s\\\\n' \\"\\$VALUE\\""`
    );
  });
});

describe('resolveRemoteHome', () => {
  it('returns trimmed remote home', async () => {
    const ctx = makeCtx(' /home/ubuntu \n');
    await expect(resolveRemoteHome(ctx)).resolves.toBe('/home/ubuntu');
    expect(ctx.exec).toHaveBeenCalledWith('sh', ['-c', 'printf %s "$HOME"']);
  });

  it('throws when remote home is empty', async () => {
    const ctx = makeCtx('   ');
    await expect(resolveRemoteHome(ctx)).rejects.toThrow('Remote home directory is empty');
  });
});

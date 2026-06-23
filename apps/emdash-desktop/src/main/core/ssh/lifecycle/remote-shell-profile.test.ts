import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  buildRemoteShellCommand,
  buildRemoteShellCommandWithPathLookup,
  captureRemoteShellProfile,
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

function makeRemoteShellClient(outputs: string[]) {
  const commands: string[] = [];
  const exec = vi.fn(
    (command: string, callback: (error: Error | undefined, channel: unknown) => void) => {
      commands.push(command);
      const stdout = outputs.shift() ?? '';
      const listeners = new Map<string, (value: unknown) => void>();
      const channel = {
        on: vi.fn((event: string, handler: (value: unknown) => void) => {
          listeners.set(event, handler);
          return channel;
        }),
        stderr: {
          on: vi.fn(() => channel.stderr),
        },
        destroy: vi.fn(),
      };

      callback(undefined, channel);
      queueMicrotask(() => {
        listeners.get('data')?.(Buffer.from(stdout));
        listeners.get('close')?.(0);
      });
    }
  );

  return { commands, exec };
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
      "'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export NVM_DIR='\\''/Users/jona/.nvm'\\''; which claude'"
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

    expect(command).toContain("export PATH='\\''/captured/bin:/usr/bin'\\''");
    expect(command).toContain("export PATH='\\''/task/bin:/usr/bin'\\''");
    expect(command.indexOf('/captured/bin')).toBeLessThan(command.indexOf('/task/bin'));
    expect(command).toContain("export FOO='\\''task'\\''; node --version");
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

    expect(command).toBe("'/bin/sh' -c 'which claude'");
  });

  it('falls back to sh for captured csh-family login shells', () => {
    const command = buildRemoteShellCommand(
      {
        shell: '/bin/tcsh',
        env: {
          PATH: '/usr/bin',
        },
      },
      'which claude',
      { FOO: 'bar!' }
    );

    expect(command).toBe(
      "'/bin/sh' -c 'export PATH='\\''/usr/bin'\\''; export FOO='\\''bar!'\\''; which claude'"
    );
  });

  it.each(['/bin/csh', '/bin/tcsh'])(
    'captures %s login shell env through the supported sh fallback',
    async (shell) => {
      const client = makeRemoteShellClient([shell, 'HOME=/Users/jona\nPATH=/usr/bin\n']);

      await expect(captureRemoteShellProfile(client)).resolves.toEqual({
        shell: '/bin/sh',
        env: {
          HOME: '/Users/jona',
          PATH: '/Users/jona/.local/bin:/usr/bin',
        },
      });

      expect(client.commands[1]).toContain("'/bin/sh' -ic 'env'");
    }
  );

  it('captures fish login shell env without replacing the profile shell', async () => {
    const client = makeRemoteShellClient([
      '/usr/local/bin/fish',
      'HOME=/Users/jona\nPATH=/usr/local/bin:/usr/bin\n',
    ]);

    await expect(captureRemoteShellProfile(client)).resolves.toEqual({
      shell: '/usr/local/bin/fish',
      env: {
        HOME: '/Users/jona',
        PATH: '/Users/jona/.local/bin:/usr/local/bin:/usr/bin',
      },
    });

    expect(client.commands[1]).toContain("'/usr/local/bin/fish' -ilc 'env'");
  });

  it('uses csh-compatible environment setup for explicit remote csh path lookup', () => {
    const command = buildRemoteShellCommandWithPathLookup(
      {
        shell: '/bin/tcsh',
        env: {
          PATH: '/usr/bin',
          SHELL: '/bin/tcsh',
        },
      },
      'tcsh',
      'echo ready',
      { FOO: 'bar!' }
    );

    expect(command).toContain("'/usr/bin/env' 'PATH=/usr/bin' 'tcsh' -c");
    expect(command).toContain("setenv PATH '\\''/usr/bin'\\''");
    expect(command).toContain("setenv SHELL '\\''tcsh'\\''");
    expect(command).toContain("setenv FOO '\\''bar\\!'\\''");
    expect(command).toContain('echo ready');
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
      "'/bin/zsh' -lc 'export PATH='\\''/usr/bin'\\''; export GOOD_NAME='\\''value'\\''; export ALSO_GOOD='\\''yes'\\''; env'"
    );
  });

  it('falls back to /bin/sh when the remote shell is empty or not absolute', () => {
    expect(normalizeRemoteShell('')).toBe('/bin/sh');
    expect(normalizeRemoteShell('zsh')).toBe('/bin/sh');
    expect(normalizeRemoteShell('/bin/zsh\n')).toBe('/bin/zsh');
    expect(normalizeRemoteShell('/bin/tcsh')).toBe('/bin/sh');
  });

  it('preserves fish as a supported remote login shell', () => {
    expect(normalizeRemoteShell('/usr/local/bin/fish')).toBe('/usr/local/bin/fish');
    expect(buildRemoteShellCommand({ shell: '/usr/local/bin/fish', env: {} }, 'echo ok')).toBe(
      "'/bin/sh' -c 'echo ok'"
    );
  });

  it('falls back to /bin/sh for unsupported remote shells', () => {
    expect(normalizeRemoteShell('/bin/elvish')).toBe('/bin/sh');
    expect(buildRemoteShellCommand({ shell: '/bin/elvish', env: {} }, 'echo ok')).toBe(
      "'/bin/sh' -c 'echo ok'"
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

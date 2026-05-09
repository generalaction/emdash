import { describe, expect, it } from 'vitest';
import {
  buildRemoteShellCommand,
  FALLBACK_REMOTE_SHELL_PROFILE,
  normalizeRemoteShell,
  type RemoteShellProfile,
} from './remote-shell-profile';

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

  it('uses /bin/sh without login flags for the fallback profile', () => {
    const command = buildRemoteShellCommand(FALLBACK_REMOTE_SHELL_PROFILE, 'which claude');

    expect(command).toBe("'/bin/sh' -c 'which claude'");
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
  });

  it('falls back to /bin/sh for unsupported remote shells', () => {
    expect(normalizeRemoteShell('/usr/local/bin/fish')).toBe('/bin/sh');
    expect(buildRemoteShellCommand({ shell: '/usr/local/bin/fish', env: {} }, 'echo ok')).toBe(
      "'/bin/sh' -c 'echo ok'"
    );
  });
});

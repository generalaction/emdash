import { describe, expect, it } from 'vitest';
import type { ResolvedPtyShellProfile } from './local-spawn';
import { resolveLocalPtySpawn } from './local-spawn';

const powershellProfile: ResolvedPtyShellProfile = {
  id: 'pwsh',
  resolvedShellId: 'pwsh',
  resolvedFromSystem: false,
  executable: 'C:\\Program Files\\PowerShell\\pwsh.exe',
  family: 'powershell',
  interactiveArgs: ['-NoLogo'],
  commandArgs: ['-NoLogo', '-Command'],
};

describe('resolveLocalPtySpawn', () => {
  it('keeps plain POSIX argv launches direct', () => {
    expect(
      resolveLocalPtySpawn({
        platform: 'linux',
        env: { SHELL: '/bin/zsh' },
        intent: {
          kind: 'run-command',
          cwd: '/workspace',
          command: { kind: 'argv', command: '/opt/provider', args: ['run', 'hello world'] },
        },
      })
    ).toEqual({
      command: '/opt/provider',
      args: ['run', 'hello world'],
      cwd: '/workspace',
      warnings: [],
    });
  });

  it('runs cmd shims through cmd even when PowerShell is the selected profile', () => {
    const shim = 'C:\\Program Files\\npm\\provider.cmd';
    const resolved = resolveLocalPtySpawn({
      platform: 'win32',
      env: {
        Path: 'C:\\Program Files\\npm',
        PATHEXT: '.EXE;.CMD',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
      intent: {
        kind: 'run-command',
        cwd: 'C:\\workspace',
        command: { kind: 'argv', command: 'provider', args: ['run', 'hello world'] },
        shellProfile: powershellProfile,
      },
      fileExists: (candidate) => candidate.toLowerCase() === shim.toLowerCase(),
    });

    expect(resolved).toMatchObject({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', expect.stringMatching(/provider\.cmd/i)],
      warnings: [],
    });
  });

  it('uses the selected PowerShell profile for ps1 files', () => {
    const script = 'C:\\Program Files\\Provider\\provider.ps1';
    const resolved = resolveLocalPtySpawn({
      platform: 'win32',
      env: {},
      intent: {
        kind: 'run-command',
        cwd: 'C:\\workspace',
        command: { kind: 'argv', command: script, args: ['run'] },
        shellProfile: powershellProfile,
      },
      fileExists: (candidate) => candidate === script,
    });

    expect(resolved).toMatchObject({
      command: powershellProfile.executable,
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', script, 'run'],
    });
  });
});

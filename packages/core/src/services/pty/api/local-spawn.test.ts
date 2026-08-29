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

  it('runs setup and a command in the selected Windows PowerShell profile', () => {
    const resolved = resolveLocalPtySpawn({
      platform: 'win32',
      env: {},
      intent: {
        kind: 'run-command',
        cwd: 'C:\\workspace',
        command: { kind: 'shell-line', commandLine: 'pnpm install' },
        shellSetup: '$env:COREPACK_HOME = "C:\\Corepack"',
        shellProfile: powershellProfile,
      },
    });

    expect(resolved).toEqual({
      command: powershellProfile.executable,
      args: [
        '-NoLogo',
        '-Command',
        '$env:COREPACK_HOME = "C:\\Corepack"\nif ($?) {\npnpm install\n}',
      ],
      cwd: 'C:\\workspace',
      warnings: [],
    });
  });

  it.each([
    {
      name: 'cmd',
      platform: 'win32' as const,
      executable: 'C:\\Windows\\System32\\cmd.exe',
      family: 'windows-cmd' as const,
      commandArgs: ['/d', '/s', '/c'],
    },
    {
      name: 'Windows PowerShell',
      platform: 'win32' as const,
      executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      family: 'powershell' as const,
      commandArgs: ['-NoProfile', '-Command'],
    },
    {
      name: 'pwsh',
      platform: 'win32' as const,
      executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      family: 'powershell' as const,
      commandArgs: ['-NoProfile', '-Command'],
    },
    {
      name: 'WSL',
      platform: 'win32' as const,
      executable: 'C:\\Windows\\System32\\wsl.exe',
      family: 'wsl' as const,
      commandArgs: ['--exec', 'sh', '-lc'],
    },
    {
      name: 'POSIX',
      platform: 'linux' as const,
      executable: '/bin/sh',
      family: 'posix' as const,
      commandArgs: ['-c'],
    },
    {
      name: 'csh',
      platform: 'linux' as const,
      executable: '/bin/csh',
      family: 'csh' as const,
      commandArgs: ['-c'],
    },
  ])('uses the declared $name profile for shell-line commands', (entry) => {
    const resolved = resolveLocalPtySpawn({
      platform: entry.platform,
      env: {},
      intent: {
        kind: 'run-command',
        cwd: entry.platform === 'win32' ? 'C:\\workspace' : '/workspace',
        command: { kind: 'shell-line', commandLine: 'echo ready' },
        shellProfile: {
          id: 'target-default',
          resolvedShellId: entry.family === 'csh' ? 'csh' : 'sh',
          resolvedFromSystem: false,
          executable: entry.executable,
          family: entry.family,
          interactiveArgs: [],
          commandArgs: entry.commandArgs,
        },
      },
    });

    expect(resolved.command).toBe(entry.executable);
    expect(resolved.args.slice(0, entry.commandArgs.length)).toEqual(entry.commandArgs);
  });
});

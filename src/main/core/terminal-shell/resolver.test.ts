import { describe, expect, it, vi } from 'vitest';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import {
  getLocalTerminalShellAvailability,
  getRemoteTerminalShellAvailability,
  resolveTerminalShell,
  ShellUnavailableError,
} from './resolver';

describe('terminal shell resolver', () => {
  it('keeps system intent while recording the concrete local shell', async () => {
    const profile = await resolveTerminalShell({
      intent: 'system',
      target: {
        kind: 'local',
        platform: 'darwin',
        env: { SHELL: '/bin/zsh' },
      },
    });

    expect(profile).toMatchObject({
      id: 'target-default',
      resolvedShellId: 'zsh',
      resolvedFromSystem: true,
      executable: '/bin/zsh',
    });
  });

  it('keeps login-shell args for fish local system shells', async () => {
    const profile = await resolveTerminalShell({
      intent: 'system',
      target: {
        kind: 'local',
        platform: 'darwin',
        env: { SHELL: '/opt/homebrew/bin/fish' },
      },
    });

    expect(profile).toMatchObject({
      id: 'target-default',
      resolvedShellId: 'fish',
      resolvedFromSystem: true,
      executable: '/opt/homebrew/bin/fish',
      family: 'posix',
      interactiveArgs: ['-il'],
      commandArgs: ['-lc'],
    });
  });

  it('uses ComSpec as the Windows system shell', async () => {
    const profile = await resolveTerminalShell({
      intent: 'system',
      target: {
        kind: 'local',
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      },
    });

    expect(profile).toMatchObject({
      id: 'target-default',
      resolvedShellId: 'cmd',
      executable: 'C:\\Windows\\System32\\cmd.exe',
      family: 'windows-cmd',
    });
  });

  it('reports Windows shells separately from POSIX shells', async () => {
    const availability = await getLocalTerminalShellAvailability({
      platform: 'win32',
      env: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        Path: 'C:\\Windows\\System32',
        PATHEXT: '.EXE;.CMD',
      },
      fileExists: (candidate) => candidate === 'C:\\Windows\\System32\\powershell.exe',
    });

    expect(availability.find((entry) => entry.id === 'system')).toMatchObject({
      available: true,
      label: 'cmd',
      isSystemDefault: true,
    });
    expect(availability.find((entry) => entry.id === 'cmd')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'powershell')?.available).toBe(true);
    expect(availability.find((entry) => entry.id === 'pwsh')?.available).toBe(false);
    expect(availability.find((entry) => entry.id === 'zsh')).toBeUndefined();
    expect(availability.map((entry) => entry.id)).toEqual(['system', 'powershell', 'pwsh', 'bash']);
  });

  it('filters Windows-only shells out of POSIX local availability', async () => {
    const availability = await getLocalTerminalShellAvailability({
      platform: 'darwin',
      env: { PATH: '/bin:/usr/bin' },
      fileExists: (candidate) => candidate === '/bin/zsh' || candidate === '/bin/bash',
    });

    expect(availability.find((entry) => entry.id === 'cmd')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'powershell')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'pwsh')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'system')).toMatchObject({
      label: 'zsh',
      isSystemDefault: true,
    });
    expect(availability.find((entry) => entry.id === 'bash')?.available).toBe(true);
    expect(availability.find((entry) => entry.id === 'zsh')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'fish')?.available).toBe(false);
    expect(availability.at(-1)?.available).toBe(false);
  });

  it('labels unknown local system shells by executable basename', async () => {
    const availability = await getLocalTerminalShellAvailability({
      platform: 'darwin',
      env: { SHELL: '/opt/homebrew/bin/fish', PATH: '/bin:/usr/bin' },
      fileExists: () => false,
    });

    expect(availability.find((entry) => entry.id === 'system')).toMatchObject({
      label: 'fish',
      isSystemDefault: true,
    });
    expect(availability.find((entry) => entry.id === 'fish')).toBeUndefined();
  });

  it('throws for unavailable explicit local shells', async () => {
    await expect(
      resolveTerminalShell({
        intent: 'zsh',
        target: { kind: 'local', platform: 'linux', env: { PATH: '/usr/bin' } },
        fileExists: () => false,
      })
    ).rejects.toBeInstanceOf(ShellUnavailableError);
  });

  it('marks explicit remote shells for PATH lookup after availability succeeds', async () => {
    const proxy = {
      exec: vi.fn((_command, callback) => {
        callback(undefined, {
          on(event: string, handler: (code?: number | null) => void) {
            if (event === 'close') handler(0);
            return this;
          },
          stderr: { on: vi.fn() },
        });
      }),
    } as unknown as SshClientProxy;

    const profile = await resolveTerminalShell({
      intent: 'bash',
      target: {
        kind: 'ssh',
        proxy,
        profile: { shell: '/bin/zsh', env: { PATH: '/usr/local/bin:/usr/bin' } },
      },
    });

    expect(profile).toMatchObject({
      id: 'bash',
      resolvedShellId: 'bash',
      executable: 'bash',
      remotePathLookup: true,
    });
  });

  it('does not offer PowerShell shells for SSH targets', async () => {
    const proxy = {
      exec: vi.fn((_command, callback) => {
        callback(undefined, {
          on(event: string, handler: (code?: number | null) => void) {
            if (event === 'close') handler(0);
            return this;
          },
          stderr: { on: vi.fn() },
        });
      }),
    } as unknown as SshClientProxy;

    const availability = await getRemoteTerminalShellAvailability(proxy, {
      shell: '/bin/zsh',
      env: { PATH: '/usr/local/bin:/usr/bin' },
    });

    expect(availability.find((entry) => entry.id === 'pwsh')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'powershell')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'system')).toMatchObject({
      label: 'zsh',
      isSystemDefault: true,
    });
    expect(availability.find((entry) => entry.id === 'zsh')).toBeUndefined();
    expect(availability.find((entry) => entry.id === 'fish')?.available).toBe(true);
  });

  it('rejects explicit remote pwsh even when a proxy is provided', async () => {
    const proxy = { exec: vi.fn() } as unknown as SshClientProxy;

    await expect(
      resolveTerminalShell({
        intent: 'pwsh',
        target: {
          kind: 'ssh',
          proxy,
          profile: { shell: '/bin/zsh', env: { PATH: '/usr/local/bin:/usr/bin' } },
        },
      })
    ).rejects.toBeInstanceOf(ShellUnavailableError);
  });

  it('keeps login-shell args for unknown remote system shells after normalization', async () => {
    const profile = await resolveTerminalShell({
      intent: 'system',
      target: {
        kind: 'ssh',
        profile: { shell: '/usr/local/bin/fish', env: { PATH: '/usr/local/bin:/usr/bin' } },
      },
    });

    expect(profile).toMatchObject({
      id: 'target-default',
      resolvedShellId: 'sh',
      resolvedFromSystem: true,
      executable: '/bin/sh',
      interactiveArgs: ['-i'],
      commandArgs: ['-c'],
    });
  });
});

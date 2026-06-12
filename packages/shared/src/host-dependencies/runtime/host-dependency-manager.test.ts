import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '../../exec/execution-context';
import { err, ok } from '../../lib/result';
import { HostDependencyManager } from './host-dependency-manager';
import type { DependencyDescriptor } from './types';

const TEST_DEPENDENCIES: DependencyDescriptor[] = [
  {
    id: 'git',
    name: 'Git',
    category: 'core',
    commands: ['git'],
    versionArgs: ['--version'],
    docUrl: 'https://git-scm.com',
  },
  {
    id: 'codex',
    name: 'Codex',
    category: 'agent',
    commands: ['codex'],
    versionArgs: ['--version'],
    docUrl: 'https://openai.com',
    installCommands: {
      macos: [{ method: 'npm', command: 'npm install -g @openai/codex', recommended: true }],
      linux: [{ method: 'npm', command: 'npm install -g @openai/codex', recommended: true }],
      windows: [{ method: 'npm', command: 'npm install -g @openai/codex', recommended: true }],
    },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@openai/codex' },
      update: { kind: 'package-manager' },
    },
  },
  {
    id: 'letta',
    name: 'Letta',
    category: 'agent',
    commands: ['letta'],
    skipVersionProbe: true,
    versionArgs: ['--version'],
    docUrl: 'https://letta.ai',
  },
  {
    id: 'claude',
    name: 'Claude',
    category: 'agent',
    commands: ['claude'],
    versionArgs: ['--version'],
    docUrl: 'https://claude.ai',
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@anthropic-ai/claude-code' },
      update: { kind: 'cli', args: ['update'] },
    },
  },
];

function makeCtx(
  handler: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
  options: {
    refreshShellEnv?: () => Promise<void>;
  } = {}
): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn().mockImplementation(handler),
    refreshShellEnv: options.refreshShellEnv
      ? vi.fn().mockImplementation(options.refreshShellEnv)
      : undefined,
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;
}

const missingCtx = makeCtx(async () => {
  throw new Error('missing');
});

const availableCtx = makeCtx(async (command, args = []) => {
  if (command === 'which' && args[0] === 'codex') {
    return { stdout: '/bin/codex\n', stderr: '' };
  }
  if (command === '/bin/codex' && args[0] === '--version') {
    return { stdout: 'codex-cli 1.2.3\n', stderr: '' };
  }
  throw new Error('missing');
});

describe('HostDependencyManager install', () => {
  it('runs dependency install commands through the configured runner before probing', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const manager = new HostDependencyManager(missingCtx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand,
    });

    const result = await manager.install('codex');

    expect(runInstallCommand).toHaveBeenCalledWith('npm install -g @openai/codex');
    expect(result).toEqual({
      success: false,
      error: { type: 'not-detected-after-install', id: 'codex' },
    });
  });

  it('returns an error result for unknown dependency ids', async () => {
    const manager = new HostDependencyManager(missingCtx, { dependencies: TEST_DEPENDENCIES });

    const result = await manager.install('missing-agent');

    expect(result).toEqual({
      success: false,
      error: { type: 'unknown-dependency', id: 'missing-agent' },
    });
  });

  it('returns an error result when no install command is configured', async () => {
    const manager = new HostDependencyManager(missingCtx, { dependencies: TEST_DEPENDENCIES });

    const result = await manager.install('git');

    expect(result).toEqual({
      success: false,
      error: { type: 'no-install-command', id: 'git' },
    });
  });

  it('returns runner errors without probing again', async () => {
    const runInstallCommand = vi.fn(async () =>
      err({
        type: 'permission-denied' as const,
        message: 'User does not have sufficient permissions.',
        output: 'permission denied',
        exitCode: 243,
      })
    );
    const manager = new HostDependencyManager(availableCtx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand,
    });

    const result = await manager.install('codex');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('permission-denied');
  });

  it('refreshes cached shell environment before running an install command', async () => {
    let shellEnvRefreshed = false;
    const ctx = makeCtx(
      async () => {
        throw new Error('missing');
      },
      {
        refreshShellEnv: async () => {
          shellEnvRefreshed = true;
        },
      }
    );
    const runInstallCommand = vi.fn(async () => {
      expect(shellEnvRefreshed).toBe(true);
      return err({
        type: 'command-failed' as const,
        message: 'Install command failed.',
        output: 'npm command not found',
        exitCode: 127,
      });
    });
    const manager = new HostDependencyManager(ctx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand,
    });

    const result = await manager.install('codex');

    expect(result.success).toBe(false);
    expect(ctx.refreshShellEnv).toHaveBeenCalledTimes(1);
    expect(runInstallCommand).toHaveBeenCalled();
  });

  it('returns the available dependency state on successful install and probe', async () => {
    const manager = new HostDependencyManager(availableCtx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand: async () => ok<void>(),
    });

    const result = await manager.install('codex');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('available');
  });

  it('refreshes cached shell environment after install before probing', async () => {
    let shellEnvRefreshed = false;
    const ctx = makeCtx(
      async (command, args = []) => {
        if (command === 'which' && args[0] === 'codex' && shellEnvRefreshed) {
          return { stdout: '/home/user/.local/bin/codex\n', stderr: '' };
        }
        if (command === '/home/user/.local/bin/codex' && args[0] === '--version') {
          return { stdout: 'codex-cli 1.2.3\n', stderr: '' };
        }
        throw new Error('missing');
      },
      {
        refreshShellEnv: async () => {
          shellEnvRefreshed = true;
        },
      }
    );
    const manager = new HostDependencyManager(ctx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand: async () => ok<void>(),
    });

    const result = await manager.install('codex');

    expect(result.success).toBe(true);
    expect(ctx.refreshShellEnv).toHaveBeenCalledTimes(2);
  });

  it('refreshes shell env once before a user-triggered category probe', async () => {
    const ctx = makeCtx(
      async (command, args = []) => {
        if (command === 'which' && args[0] === 'codex') {
          return { stdout: '/bin/codex\n', stderr: '' };
        }
        if (command === '/bin/codex' && args[0] === '--version') {
          return { stdout: 'codex-cli 1.2.3\n', stderr: '' };
        }
        throw new Error('missing');
      },
      {
        refreshShellEnv: async () => {},
      }
    );
    const manager = new HostDependencyManager(ctx, { dependencies: TEST_DEPENDENCIES });

    await manager.probeCategory('agent', { refreshShellEnv: true });

    expect(ctx.refreshShellEnv).toHaveBeenCalledTimes(1);
  });

  it('does not force refresh during background probing', async () => {
    const ctx = makeCtx(
      async () => {
        throw new Error('missing');
      },
      {
        refreshShellEnv: async () => {},
      }
    );
    const manager = new HostDependencyManager(ctx, { dependencies: TEST_DEPENDENCIES });

    await manager.probeCategory('agent');

    expect(ctx.refreshShellEnv).not.toHaveBeenCalled();
  });

  it('refreshes shell env once before a user-triggered full probe', async () => {
    const ctx = makeCtx(
      async () => {
        throw new Error('missing');
      },
      {
        refreshShellEnv: async () => {},
      }
    );
    const manager = new HostDependencyManager(ctx, { dependencies: TEST_DEPENDENCIES });

    await manager.probeAll({ refreshShellEnv: true });

    expect(ctx.refreshShellEnv).toHaveBeenCalledTimes(1);
  });

  it('skips version probes for dependencies configured as path-only', async () => {
    const ctx = makeCtx(async (command, args = []) => {
      if (command === 'which' && args[0] === 'letta') {
        return { stdout: '/bin/letta\n', stderr: '' };
      }
      if (command === '/bin/letta') {
        throw new Error('letta should not be executed during dependency probing');
      }
      throw new Error('missing');
    });
    const manager = new HostDependencyManager(ctx, { dependencies: TEST_DEPENDENCIES });

    const result = await manager.probe('letta');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'letta',
        status: 'available',
        path: '/bin/letta',
        version: null,
      })
    );
    expect(ctx.exec).toHaveBeenCalledTimes(1);
    expect(ctx.exec).toHaveBeenCalledWith('which', ['letta'], { timeout: 5000 });
  });

  it('fires onStatusUpdated with the SSH connection id', async () => {
    const manager = new HostDependencyManager(availableCtx, {
      dependencies: TEST_DEPENDENCIES,
      connectionId: 'ssh-1',
    });
    const listener = vi.fn();
    manager.onStatusUpdated.subscribe(listener);

    await manager.probe('codex');

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'codex',
        connectionId: 'ssh-1',
        state: expect.objectContaining({ id: 'codex', status: 'available' }),
      })
    );
  });
});

describe('HostDependencyManager update', () => {
  it('returns unknown-dependency error for an unrecognised id', async () => {
    const manager = new HostDependencyManager(missingCtx, { dependencies: TEST_DEPENDENCIES });
    const result = await manager.update('unknown-agent');
    expect(result).toEqual({
      success: false,
      error: { type: 'unknown-dependency', id: 'unknown-agent' },
    });
  });

  it('returns no-update-strategy for a core dependency without updates', async () => {
    const manager = new HostDependencyManager(missingCtx, { dependencies: TEST_DEPENDENCIES });
    const result = await manager.update('git');
    expect(result).toEqual({ success: false, error: { type: 'no-update-strategy', id: 'git' } });
  });

  it('runs the install command for a package-manager update strategy', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const manager = new HostDependencyManager(availableCtx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand,
    });

    const result = await manager.update('codex');

    // codex uses package-manager strategy
    expect(runInstallCommand).toHaveBeenCalledWith('npm install -g @openai/codex');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('available');
  });

  it('returns runner error without probing when update command fails', async () => {
    const runInstallCommand = vi.fn(async () =>
      err({
        type: 'permission-denied' as const,
        message: 'User does not have sufficient permissions.',
        output: 'permission denied',
        exitCode: 243,
      })
    );
    const manager = new HostDependencyManager(missingCtx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand,
    });

    const result = await manager.update('codex');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('permission-denied');
  });

  it('uses claude update args for cli strategy', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const claudeCtx = makeCtx(async (command, args = []) => {
      if (command === 'which' && args[0] === 'claude') {
        return { stdout: '/usr/local/bin/claude\n', stderr: '' };
      }
      if (command === '/usr/local/bin/claude' && args[0] === '--version') {
        return { stdout: 'claude 1.0.0\n', stderr: '' };
      }
      throw new Error('missing');
    });
    const manager = new HostDependencyManager(claudeCtx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand,
    });

    await manager.update('claude');

    expect(runInstallCommand).toHaveBeenCalledWith(expect.stringContaining('update'));
  });
});

describe('HostDependencyManager uninstall', () => {
  const UNINSTALL_DEPENDENCIES: typeof TEST_DEPENDENCIES = [
    ...TEST_DEPENDENCIES,
    {
      id: 'codex-pm',
      name: 'Codex (package-manager uninstall)',
      category: 'agent',
      commands: ['codex'],
      versionArgs: ['--version'],
      docUrl: 'https://openai.com',
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
            recommended: true,
            uninstallCommand: 'npm uninstall -g @openai/codex',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
            recommended: true,
            uninstallCommand: 'npm uninstall -g @openai/codex',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
            recommended: true,
            uninstallCommand: 'npm uninstall -g @openai/codex',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'npm', package: '@openai/codex' },
        update: { kind: 'package-manager' },
      },
      uninstall: { kind: 'package-manager' },
    },
    {
      id: 'codex-pm-no-cmd',
      name: 'Codex (package-manager, no uninstallCommand)',
      category: 'agent',
      commands: ['codex'],
      versionArgs: ['--version'],
      installCommands: {
        macos: [{ method: 'npm', command: 'npm install -g @openai/codex', recommended: true }],
      },
      updates: { kind: 'none' },
      uninstall: { kind: 'package-manager' },
    },
    {
      id: 'claude-cli-uninstall',
      name: 'Claude (cli uninstall)',
      category: 'agent',
      commands: ['claude'],
      versionArgs: ['--version'],
      updates: { kind: 'none' },
      uninstall: { kind: 'cli', args: ['uninstall'] },
    },
    {
      id: 'claude-hook-uninstall',
      name: 'Claude (hook uninstall)',
      category: 'agent',
      commands: ['claude'],
      versionArgs: ['--version'],
      updates: { kind: 'none' },
      uninstall: { kind: 'cli', args: ['uninstall'] },
      updateHooks: {
        buildUninstallCommand: (binaryPath: string) => ({
          command: binaryPath,
          args: ['custom-remove', '--force'],
        }),
      },
    },
  ];

  it('returns unknown-dependency error for an unrecognised id', async () => {
    const manager = new HostDependencyManager(missingCtx, {
      dependencies: UNINSTALL_DEPENDENCIES,
    });
    const result = await manager.uninstall('unknown-agent');
    expect(result).toEqual({
      success: false,
      error: { type: 'unknown-dependency', id: 'unknown-agent' },
    });
  });

  it('returns no-uninstall-strategy when strategy is none', async () => {
    const manager = new HostDependencyManager(missingCtx, {
      dependencies: UNINSTALL_DEPENDENCIES,
    });
    // 'git' has no uninstall field (undefined → treated as none)
    const result = await manager.uninstall('git');
    expect(result).toEqual({
      success: false,
      error: { type: 'no-uninstall-strategy', id: 'git' },
    });
  });

  it('returns no-uninstall-command when strategy is package-manager but the option has no uninstallCommand', async () => {
    const manager = new HostDependencyManager(missingCtx, {
      dependencies: UNINSTALL_DEPENDENCIES,
    });
    const result = await manager.uninstall('codex-pm-no-cmd');
    expect(result).toEqual({
      success: false,
      error: { type: 'no-uninstall-command', id: 'codex-pm-no-cmd' },
    });
  });

  it('runs the uninstallCommand for package-manager strategy and re-probes', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const manager = new HostDependencyManager(missingCtx, {
      dependencies: UNINSTALL_DEPENDENCIES,
      runInstallCommand,
    });

    const result = await manager.uninstall('codex-pm');

    expect(runInstallCommand).toHaveBeenCalledWith('npm uninstall -g @openai/codex');
    // After uninstall the binary is gone → status is 'missing', which is success
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('missing');
  });

  it('returns runner error when the uninstall command fails', async () => {
    const runInstallCommand = vi.fn(async () =>
      err({
        type: 'permission-denied' as const,
        message: 'User does not have sufficient permissions.',
        output: 'permission denied',
        exitCode: 243,
      })
    );
    const manager = new HostDependencyManager(missingCtx, {
      dependencies: UNINSTALL_DEPENDENCIES,
      runInstallCommand,
    });

    const result = await manager.uninstall('codex-pm');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('permission-denied');
  });

  it('runs <binary> <args> for cli strategy and re-probes', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const claudeCtx = makeCtx(async (command, args = []) => {
      if (command === 'which' && args[0] === 'claude') {
        return { stdout: '/usr/local/bin/claude\n', stderr: '' };
      }
      throw new Error('missing');
    });
    const manager = new HostDependencyManager(claudeCtx, {
      dependencies: UNINSTALL_DEPENDENCIES,
      runInstallCommand,
    });

    await manager.uninstall('claude-cli-uninstall');

    expect(runInstallCommand).toHaveBeenCalledWith(expect.stringContaining('uninstall'));
  });

  it('uses buildUninstallCommand hook when provided', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const claudeCtx = makeCtx(async (command, args = []) => {
      if (command === 'which' && args[0] === 'claude') {
        return { stdout: '/usr/local/bin/claude\n', stderr: '' };
      }
      throw new Error('missing');
    });
    const manager = new HostDependencyManager(claudeCtx, {
      dependencies: UNINSTALL_DEPENDENCIES,
      runInstallCommand,
    });

    await manager.uninstall('claude-hook-uninstall');

    expect(runInstallCommand).toHaveBeenCalledWith('/usr/local/bin/claude custom-remove --force');
  });
});

describe('HostDependencyManager unknown install source', () => {
  // A path that won't match any location hint so inferMethod() returns null
  const UNKNOWN_PATH = '/opt/custom-shims/codex';

  const unknownCtx = makeCtx(async (command, args = []) => {
    if (command === 'which' && args[0] === 'codex') {
      return { stdout: `${UNKNOWN_PATH}\n`, stderr: '' };
    }
    if (command === 'realpath') {
      return { stdout: `${UNKNOWN_PATH}\n`, stderr: '' };
    }
    if (command === UNKNOWN_PATH && args[0] === '--version') {
      return { stdout: 'codex-cli 1.0.0\n', stderr: '' };
    }
    throw new Error('missing');
  });

  it('emits source { kind: "unknown" } when method inference fails', async () => {
    const manager = new HostDependencyManager(unknownCtx, {
      dependencies: TEST_DEPENDENCIES,
      connectionId: 'local',
    });
    const events: unknown[] = [];
    manager.onStatusUpdated.subscribe((e) => events.push(e));

    await manager.probe('codex');
    // Wait for the async buildAndStoreHostDependency
    await new Promise((r) => setTimeout(r, 50));

    const hostDepEvent = (events as Array<{ hostDependency?: unknown }>).find(
      (e) => e.hostDependency !== undefined
    );
    expect(hostDepEvent).toBeDefined();

    const hostDep = (hostDepEvent as { hostDependency: { installations: Array<{ source: unknown }> } }).hostDependency;
    const autoInst = hostDep.installations.find(
      (i: { id: string }) => i.id === 'auto'
    );
    expect(autoInst).toBeDefined();
    expect((autoInst as { source: { kind: string } }).source.kind).toBe('unknown');
  });

  it('refuses package-manager update when used installation has unknown source', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const manager = new HostDependencyManager(unknownCtx, {
      dependencies: TEST_DEPENDENCIES,
      runInstallCommand,
    });

    await manager.probe('codex');
    // Wait for the async buildAndStoreHostDependency so hostState is populated
    await new Promise((r) => setTimeout(r, 50));

    const result = await manager.update('codex');

    expect(result).toEqual({
      success: false,
      error: { type: 'no-update-strategy', id: 'codex' },
    });
    expect(runInstallCommand).not.toHaveBeenCalled();
  });
});

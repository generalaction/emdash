import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { err, ok } from '@shared/lib/result';
import { DependencyManager } from './dependency-manager';

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn(async () => ({
      autoCopyOnSelection: false,
      macOptionIsMeta: false,
      defaultShell: 'system',
      fontSize: 13,
    })),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('../ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    connect: vi.fn(),
  },
}));

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

const { events } = await import('@main/lib/events');

describe('DependencyManager install', () => {
  it('runs dependency install commands through the configured runner before probing', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const manager = new DependencyManager(missingCtx, {
      emitEvents: false,
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
    const manager = new DependencyManager(missingCtx, { emitEvents: false });

    const result = await manager.install('missing-agent' as never);

    expect(result).toEqual({
      success: false,
      error: { type: 'unknown-dependency', id: 'missing-agent' },
    });
  });

  it('returns an error result when no install command is configured', async () => {
    const manager = new DependencyManager(missingCtx, { emitEvents: false });

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
    const manager = new DependencyManager(availableCtx, {
      emitEvents: false,
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
    const manager = new DependencyManager(ctx, {
      emitEvents: false,
      runInstallCommand,
    });

    const result = await manager.install('codex');

    expect(result.success).toBe(false);
    expect(ctx.refreshShellEnv).toHaveBeenCalledTimes(1);
    expect(runInstallCommand).toHaveBeenCalled();
  });

  it('returns the available dependency state on successful install and probe', async () => {
    const manager = new DependencyManager(availableCtx, {
      emitEvents: false,
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
    const manager = new DependencyManager(ctx, {
      emitEvents: false,
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
    const manager = new DependencyManager(ctx, { emitEvents: false });

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
    const manager = new DependencyManager(ctx, { emitEvents: false });

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
    const manager = new DependencyManager(ctx, { emitEvents: false });

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
    const manager = new DependencyManager(ctx, { emitEvents: false });

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

  it('emits dependency updates with the SSH connection id', async () => {
    const manager = new DependencyManager(availableCtx, {
      connectionId: 'ssh-1',
    });

    await manager.probe('codex');

    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'codex',
        connectionId: 'ssh-1',
        state: expect.objectContaining({ id: 'codex', status: 'available' }),
      })
    );
  });
});

describe('DependencyManager probe phase-1 enrichment preservation', () => {
  it('carries forward latestVersion and updateAvailable from the previous state during phase 1', async () => {
    const manager = new DependencyManager(availableCtx, { emitEvents: true, connectionId: 'local' });

    // First probe: populate the internal state with a known state.
    await manager.probe('codex');

    // Manually inject latestVersion/updateAvailable into the stored state to
    // simulate what fetchAndUpdateLatestVersion sets after a background version check.
    const internalState = (manager as unknown as { state: Map<string, unknown> }).state;
    const existingState = internalState.get('codex') as Record<string, unknown>;
    internalState.set('codex', { ...existingState, latestVersion: '9.9.9', updateAvailable: true });

    // Reset the mock so we only look at emissions from the second probe.
    vi.mocked(events.emit).mockClear();

    // Second probe: phase 1 should preserve latestVersion/updateAvailable.
    await manager.probe('codex');

    // The first emit call is phase 1 (path resolution). It must carry the prior enrichment.
    const firstCall = vi.mocked(events.emit).mock.calls[0];
    expect(firstCall).toBeDefined();
    const firstPayload = firstCall?.[1] as { state: Record<string, unknown> };
    expect(firstPayload.state.latestVersion).toBe('9.9.9');
    expect(firstPayload.state.updateAvailable).toBe(true);
  });
});

describe('DependencyManager update', () => {
  it('returns unknown-dependency error for an unrecognised id', async () => {
    const manager = new DependencyManager(missingCtx, { emitEvents: false });
    const result = await manager.update('unknown-agent' as never);
    expect(result).toEqual({
      success: false,
      error: { type: 'unknown-dependency', id: 'unknown-agent' },
    });
  });

  it('returns no-update-strategy for a core dependency without updates', async () => {
    const manager = new DependencyManager(missingCtx, { emitEvents: false });
    // git is a core dependency with no updates descriptor
    const result = await manager.update('git');
    expect(result).toEqual({ success: false, error: { type: 'no-update-strategy', id: 'git' } });
  });

  it('runs the install command for a package-manager update strategy', async () => {
    const runInstallCommand = vi.fn(async () => ok<void>());
    const manager = new DependencyManager(availableCtx, {
      emitEvents: false,
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
    const manager = new DependencyManager(missingCtx, {
      emitEvents: false,
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
    const manager = new DependencyManager(claudeCtx, {
      emitEvents: false,
      runInstallCommand,
    });

    await manager.update('claude');

    expect(runInstallCommand).toHaveBeenCalledWith(expect.stringContaining('update'));
  });
});

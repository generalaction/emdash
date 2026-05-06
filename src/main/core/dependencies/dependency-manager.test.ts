import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { DependencyManager } from './dependency-manager';

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('../ssh/ssh-connection-manager', () => ({
  sshConnectionManager: {
    connect: vi.fn(),
  },
}));

function makeCtx(
  handler: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn().mockImplementation(handler),
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

  it('returns the available dependency state on successful install and probe', async () => {
    const manager = new DependencyManager(availableCtx, {
      emitEvents: false,
      runInstallCommand: async () => ok<void>(),
    });

    const result = await manager.install('codex');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('available');
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

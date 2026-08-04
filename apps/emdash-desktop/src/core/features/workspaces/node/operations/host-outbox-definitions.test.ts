import { formatHostRef, hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { isOperationRejectedError, type StageContext } from '@emdash/core/primitives/kernel/api';
import type {
  WorkspaceHostOperationInput,
  WorkspaceHostOperationView,
} from '@emdash/core/runtimes/workspace-host/api';
import type { RuntimeBroker, RuntimeSession } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { DisposableTimerHandle, type Clock } from '@emdash/shared/scheduling';
import { describe, expect, it, vi } from 'vitest';
import type { HostRemoveWorktreeInput } from '@core/features/workspaces/api/node/host-outbox-operations';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  createHostRemoveWorktreeDefinition,
  createHostReprovisionWorktreeDefinition,
} from './host-outbox-definitions';

const testClock: Clock = {
  now: () => 0,
  // Timeouts never fire in these tests.
  schedule: () => new DisposableTimerHandle(() => {}),
  sleep: async () => {},
};

describe('reprovision worktree operation', () => {
  it('does not create when removal fails', async () => {
    const definition = createHostReprovisionWorktreeDefinition();
    const input = definition.examples[0]!.input;
    const run = vi.fn().mockResolvedValue({
      success: false,
      error: { kind: 'failed', error: { message: 'remove failed' } },
    });

    await expect(
      definition.handler.run({
        input,
        operationId: 'reprovision-1',
        attempt: 0,
        signal: new AbortController().signal,
        run,
      } as never)
    ).rejects.toThrow('Worktree removal failed');
    expect(run).toHaveBeenCalledOnce();
  });

  it('creates only after removal succeeds', async () => {
    const definition = createHostReprovisionWorktreeDefinition();
    const input = definition.examples[0]!.input;
    const run = vi.fn().mockResolvedValue({ success: true, data: { ok: true } });

    await expect(
      definition.handler.run({
        input,
        operationId: 'reprovision-1',
        attempt: 0,
        signal: new AbortController().signal,
        run,
      } as never)
    ).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenNthCalledWith(1, expect.anything(), input.remove);
    expect(run).toHaveBeenNthCalledWith(2, expect.anything(), input.create);
  });

  it('creates without removing for a non-destructive reprovision', async () => {
    const definition = createHostReprovisionWorktreeDefinition();
    const input = { ...definition.examples[0]!.input, removeFirst: false };
    const run = vi.fn().mockResolvedValue({ success: true, data: { ok: true } });

    await expect(
      definition.handler.run({
        input,
        operationId: 'reprovision-1',
        attempt: 0,
        signal: new AbortController().signal,
        run,
      } as never)
    ).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.anything(), input.create);
  });
});

function removeWorktreeInput(
  overrides: Partial<HostRemoveWorktreeInput> = {}
): HostRemoveWorktreeInput {
  return {
    version: '1',
    source: 'user',
    hostOperationId: 'host-op-1',
    hostRef: formatHostRef(LOCAL_HOST_REF),
    repoPath: '/repo',
    workspacePath: '/repo/.worktrees/example',
    branchName: 'example',
    deleteBranch: false,
    createdAt: 0,
    ...overrides,
  };
}

function fakeCtx(input: HostRemoveWorktreeInput) {
  const stages: Array<{ id: string; status: 'succeeded' | 'failed' }> = [];
  const rejections: unknown[] = [];
  const controller = new AbortController();
  const ctx = {
    input,
    operationId: 'kernel-op-1',
    attempt: 0,
    signal: controller.signal,
    stage: async <T>(id: string, _label: string, work: (stage: StageContext) => Promise<T>) => {
      try {
        const value = await work({
          progress: () => {},
          fail: () => {},
          signal: controller.signal,
        });
        stages.push({ id, status: 'succeeded' });
        return value;
      } catch (error) {
        stages.push({ id, status: 'failed' });
        throw error;
      }
    },
    run: async () => {
      throw new Error('not used');
    },
    spawn: async () => {
      throw new Error('not used');
    },
    reject: (error: unknown): never => {
      rejections.push(error);
      throw Object.assign(new Error('rejected'), { rejected: error });
    },
    fact: () => {},
  };
  return { ctx, stages, rejections };
}

function fakeHost(options: {
  submit?: (
    request: WorkspaceHostOperationInput
  ) => ReturnType<typeof ok<{ operationId: string; kernelOperationId: string }>>;
  views: WorkspaceHostOperationView[];
}) {
  const submitted: WorkspaceHostOperationInput[] = [];
  let index = 0;
  const workspaceHost = {
    submitOperation: async (request: WorkspaceHostOperationInput) => {
      submitted.push(request);
      return (
        options.submit?.(request) ??
        ok({ operationId: request.input.operationId, kernelOperationId: 'kernel-remote-1' })
      );
    },
    getOperation: async () => {
      const view = options.views[Math.min(index, options.views.length - 1)];
      index += 1;
      return ok(view);
    },
  };
  const runtimes = {
    client: async (_host: Parameters<RuntimeBroker['client']>[0]) =>
      ok({ workspaceHost }) as unknown as RuntimeSession,
  } satisfies Pick<RuntimeBroker, 'client'>;
  return { runtimes, submitted };
}

function hostView(
  status: WorkspaceHostOperationView['status'],
  stages: WorkspaceHostOperationView['stages'] = [],
  error?: { type: 'git-command-failed'; message: string }
): WorkspaceHostOperationView {
  return {
    operationId: 'host-op-1',
    kernelOperationId: 'kernel-remote-1',
    verb: 'host.removeWorktree',
    status,
    stages,
    updatedAt: 0,
    ...(error ? { error } : {}),
  };
}

const runtime = { db: {} as AppDb, clock: testClock };

describe('host outbox removeWorktree definition', () => {
  it('submits the verb with the desktop-minted id and folds stages', async () => {
    const { runtimes, submitted } = fakeHost({
      views: [
        hostView('running', [
          { id: 'remove-worktree', label: 'Remove worktree', status: 'running' },
        ]),
        hostView('succeeded', [
          { id: 'remove-worktree', label: 'Remove worktree', status: 'succeeded' },
        ]),
      ],
    });
    const definition = createHostRemoveWorktreeDefinition({ runtimes, pollIntervalMs: 0 }, runtime);
    const input = removeWorktreeInput();
    const { ctx, stages } = fakeCtx(input);

    const result = await definition.handler.run(ctx);

    expect(result).toEqual({ ok: true });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.verb).toBe('host.removeWorktree');
    expect(submitted[0]?.input.operationId).toBe('host-op-1');
    expect(stages.map((stage) => stage.id)).toEqual([
      'submit-host-operation',
      'host:remove-worktree',
    ]);
  });

  it('rejects non-retryably when the host operation terminally fails', async () => {
    const { runtimes } = fakeHost({
      views: [hostView('failed', [], { type: 'git-command-failed', message: 'boom' })],
    });
    const definition = createHostRemoveWorktreeDefinition({ runtimes, pollIntervalMs: 0 }, runtime);
    const input = removeWorktreeInput();
    const { ctx, rejections } = fakeCtx(input);

    await expect(definition.handler.run(ctx)).rejects.toThrow();
    expect(rejections).toEqual([
      { type: 'failed', code: 'git-command-failed', message: 'boom', retryable: false },
    ]);
  });

  it('rejects non-retryably when a host stage fails', async () => {
    const { runtimes } = fakeHost({
      views: [
        hostView('running', [
          {
            id: 'remove-worktree',
            label: 'Remove worktree',
            status: 'failed',
            error: { message: 'worktree is locked' },
          },
        ]),
      ],
    });
    const definition = createHostRemoveWorktreeDefinition({ runtimes, pollIntervalMs: 0 }, runtime);
    const input = removeWorktreeInput();
    const { ctx, rejections, stages } = fakeCtx(input);

    await expect(definition.handler.run(ctx)).rejects.toThrow();
    expect(stages).toContainEqual({ id: 'host:remove-worktree', status: 'failed' });
    expect(rejections).toEqual([
      {
        type: 'failed',
        code: 'host-stage-failed',
        message: 'worktree is locked',
        retryable: false,
      },
    ]);
  });

  it('throws a retryable error when the host is unreachable', async () => {
    const runtimes = {
      client: async () =>
        err({ type: 'host-unavailable', message: 'offline' }) as unknown as RuntimeSession,
    } satisfies Pick<RuntimeBroker, 'client'>;
    const definition = createHostRemoveWorktreeDefinition({ runtimes, pollIntervalMs: 0 }, runtime);
    const input = removeWorktreeInput({ hostRef: formatHostRef(hostRef('remote', 'ssh-1')) });
    const { ctx, rejections } = fakeCtx(input);

    await expect(definition.handler.run(ctx)).rejects.toMatchObject({
      code: 'host-unreachable',
    });
    expect(rejections).toHaveLength(0);
  });

  it('runs the deactivate hook before submitting when consumers are specified', async () => {
    const order: string[] = [];
    const { runtimes } = fakeHost({ views: [hostView('succeeded')] });
    const deactivateWorkspace = vi.fn(async () => {
      order.push('deactivate');
    });
    const definition = createHostRemoveWorktreeDefinition(
      {
        runtimes: {
          client: async (...args) => {
            order.push('client');
            return runtimes.client(...args);
          },
        },
        deactivateWorkspace,
        pollIntervalMs: 0,
      },
      runtime
    );
    const input = removeWorktreeInput({ deactivateConsumers: ['task-1'] });
    const { ctx } = fakeCtx(input);

    await definition.handler.run(ctx);

    expect(deactivateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        hostRef: formatHostRef(LOCAL_HOST_REF),
        workspacePath: '/repo/.worktrees/example',
        consumers: ['task-1'],
      }),
      expect.anything()
    );
    expect(order).toEqual(['deactivate', 'client']);
  });

  it('gates reconciler proposals on confirmation', async () => {
    const { runtimes, submitted } = fakeHost({ views: [hostView('succeeded')] });
    const definition = createHostRemoveWorktreeDefinition({ runtimes, pollIntervalMs: 0 }, runtime);
    const input = removeWorktreeInput({ source: 'reconciler' });
    const { ctx, rejections } = fakeCtx(input);

    await expect(definition.handler.run(ctx)).rejects.toThrow();
    expect(rejections).toEqual([
      { type: 'needs-confirmation', reason: 'reconciler-proposed', message: undefined },
    ]);
    expect(submitted).toHaveLength(0);
  });
});

describe('host outbox descriptor', () => {
  it('exposes the prediction from the input', () => {
    const { runtimes } = fakeHost({ views: [hostView('succeeded')] });
    const definition = createHostRemoveWorktreeDefinition({ runtimes }, runtime);
    const prediction = {
      compiledAt: 1,
      observedAsOf: null,
      stages: [{ id: 's1', label: 'Remove worktree', basis: 'registry' as const }],
    };
    expect(definition.prediction?.(removeWorktreeInput({ prediction }))).toEqual(prediction);
    expect(isOperationRejectedError(new Error('x'))).toBe(false);
  });
});

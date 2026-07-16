import { err, type Result } from '@emdash/shared';
import { ManualClock } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { LifecycleOperationRow } from '@main/db/schema';
import type {
  ExecutableOperationPlan,
  OperationStepError,
  OperationStepKind,
} from './operation-plan';
import { runOperationPlan } from './plan-runner';

vi.mock('./steps/operation-step-registry', () => ({
  operationStepRegistry: { execute: vi.fn() },
}));

describe('runOperationPlan', () => {
  it('times out hung steps without retrying the expired deadline', async () => {
    const clock = new ManualClock();
    const execute = vi.fn(
      async (
        _kind: OperationStepKind,
        _operation: LifecycleOperationRow,
        signal?: AbortSignal
      ): Promise<Result<void, OperationStepError>> =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    const operation: LifecycleOperationRow = {
      id: 'operation-1',
      kind: 'delete-task',
      status: 'running',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: null,
      entityKey: 'task-1',
      hostRef: 'local',
      payload: { version: '1', source: 'user' },
      attempt: 1,
      error: null,
      createdAt: 0,
      finishedAt: null,
    };
    const plan: ExecutableOperationPlan = {
      kind: 'delete-task',
      steps: [
        {
          id: 'purge-task-rows',
          kind: 'purge-task-rows',
          label: 'Remove task data',
          destructive: true,
        },
      ],
    };

    const resultPromise = runOperationPlan(operation, plan, {
      clock,
      registry: { execute },
    });
    await Promise.resolve();
    await clock.runAll();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('step-timeout');
      expect(result.error.message).toContain('timed out after 30000ms');
    }
    expect(execute).toHaveBeenCalledOnce();
  });

  it('preserves typed step errors', async () => {
    const clock = new ManualClock();
    const execute = vi.fn(async () =>
      err<OperationStepError>({
        code: 'workspace-in-use',
        message: 'Workspace is still referenced by an active task.',
      })
    );
    const operation: LifecycleOperationRow = {
      id: 'operation-2',
      kind: 'delete-workspace',
      status: 'running',
      projectId: 'project-1',
      taskId: null,
      workspaceId: 'workspace-1',
      entityKey: 'workspace-1',
      hostRef: 'local',
      payload: { version: '1', source: 'user' },
      attempt: 1,
      error: null,
      createdAt: 0,
      finishedAt: null,
    };
    const plan: ExecutableOperationPlan = {
      kind: 'delete-workspace',
      steps: [
        {
          id: 'kill-acp-sessions',
          kind: 'kill-acp-sessions',
          label: 'Stop ACP sessions',
          destructive: false,
        },
      ],
    };

    const resultPromise = runOperationPlan(operation, plan, {
      clock,
      registry: { execute },
    });
    await Promise.resolve();
    await clock.runAll();
    const result = await resultPromise;

    expect(result).toEqual({
      success: false,
      error: {
        type: 'workspace-in-use',
        message: 'Workspace is still referenced by an active task.',
      },
    });
  });
});

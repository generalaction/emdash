import { ManualClock } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { LifecycleOperationRow } from '@main/db/schema';
import type { OperationPlan, OperationStepKind } from './operation-plan';
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
      ): Promise<void> =>
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
    const plan: OperationPlan = {
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
      expect(result.error.message).toContain('timed out after 30000ms');
    }
    expect(execute).toHaveBeenCalledOnce();
  });
});

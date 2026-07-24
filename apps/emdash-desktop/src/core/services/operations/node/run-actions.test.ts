import { ManualClock } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';
import { runOperationActions } from './run-actions';

describe('runOperationActions', () => {
  it('reports ephemeral progress without persisting action state', async () => {
    const reportProgress = vi.fn();
    const result = await runOperationActions(
      {
        operation: operation(),
        db: {} as never,
        signal: new AbortController().signal,
        clock: new ManualClock(),
        reportProgress,
      },
      [
        { id: 'first', timeoutMs: 100, run: async () => {} },
        { id: 'second', timeoutMs: 100, run: async () => {} },
      ]
    );

    expect(result).toEqual({ success: true, data: undefined });
    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completedSteps: 0, totalSteps: 2 },
      { currentStep: 'first', completedSteps: 0, totalSteps: 2 },
      { currentStep: 'second', completedSteps: 1, totalSteps: 2 },
      { completedSteps: 2, totalSteps: 2 },
    ]);
  });

  it('classifies a timed-out effect as non-retryable', async () => {
    const clock = new ManualClock();
    const resultPromise = runOperationActions(
      {
        operation: operation(),
        db: {} as never,
        signal: new AbortController().signal,
        clock,
        reportProgress: vi.fn(),
      },
      [{ id: 'hung', timeoutMs: 100, run: () => new Promise(() => {}) }]
    );
    await clock.advanceBy(100);

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      error: { type: 'failed', code: 'operation-timeout', retryable: false },
    });
  });
});

function operation(): LifecycleOperationRow {
  return {
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
}

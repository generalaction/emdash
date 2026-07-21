import { ManualClock } from '@emdash/shared/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';
import { createDeleteTaskOperationDefinition } from './delete-task-definition';

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  resolveTargets: vi.fn(),
}));

vi.mock('@main/core/workspaces/operations/lifecycle-operation-context', () => ({
  resolveLifecycleOperationContext: mocks.resolveContext,
}));

vi.mock('@main/core/runtime/operations/session-cleanup', () => ({
  resolveLifecycleSessionTargets: mocks.resolveTargets,
  killLifecycleAcpSessions: vi.fn(),
  killLifecycleTerminalSessions: vi.fn(),
}));

describe('delete-task operation definition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTargets.mockResolvedValue({
      acpConversationIds: [],
      tuiConversationIds: [],
      terminalSessionIds: [],
      tmuxSessionNames: [],
    });
  });

  it('converges successfully when the task and its effects are already gone', async () => {
    mocks.resolveContext.mockResolvedValue({
      preservePatterns: [],
    });
    const reportProgress = vi.fn();

    const result = await createDeleteTaskOperationDefinition().run({
      operation: operation(),
      db: {} as never,
      signal: new AbortController().signal,
      clock: new ManualClock(),
      reportProgress,
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(reportProgress).toHaveBeenLastCalledWith({ completedSteps: 0, totalSteps: 0 });
  });

  it('requests confirmation before destructive work on a stale task operation', async () => {
    mocks.resolveContext.mockResolvedValue({
      task: { id: 'task-1', workspaceId: null },
      preservePatterns: [],
    });

    const result = await createDeleteTaskOperationDefinition().run({
      operation: operation(),
      db: {} as never,
      signal: new AbortController().signal,
      clock: new ManualClock(25 * 60 * 60 * 1_000),
      reportProgress: vi.fn(),
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'awaiting-confirmation', reason: 'stale' },
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
    payload: { version: '1', source: 'user', deleteWorktree: true },
    attempt: 1,
    error: null,
    createdAt: 0,
    finishedAt: null,
  };
}

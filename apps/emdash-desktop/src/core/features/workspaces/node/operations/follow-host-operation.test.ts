import type { StageContext } from '@emdash/core/primitives/kernel/api';
import type {
  WorkspaceHostOperationStage,
  WorkspaceHostOperationView,
} from '@emdash/core/runtimes/workspace-host/api';
import { ok, type Result } from '@emdash/shared';
import { DisposableTimerHandle, type Clock } from '@emdash/shared/scheduling';
import { describe, expect, it } from 'vitest';
import { followHostOperation, HostStageFailedError } from './follow-host-operation';

const OPERATION_ID = 'outbox-op-1';

type JournalEntry = { id: string; label: string; status: 'succeeded' | 'failed' };

function immediateClock(): Clock {
  return {
    now: () => 0,
    schedule: () => new DisposableTimerHandle(() => {}),
    sleep: async () => {},
  };
}

function fakeCtx() {
  const journal: JournalEntry[] = [];
  const controller = new AbortController();
  return {
    journal,
    controller,
    ctx: {
      signal: controller.signal,
      stage: async <T>(
        id: string,
        label: string,
        work: (stage: StageContext) => Promise<T>
      ): Promise<T> => {
        try {
          const value = await work({ progress: () => {}, signal: controller.signal });
          journal.push({ id, label, status: 'succeeded' });
          return value;
        } catch (error) {
          journal.push({ id, label, status: 'failed' });
          throw error;
        }
      },
    },
  };
}

function view(
  status: WorkspaceHostOperationView['status'],
  stages: WorkspaceHostOperationStage[],
  error?: { type: 'git-command-failed'; message: string }
): WorkspaceHostOperationView {
  return {
    operationId: OPERATION_ID,
    kernelOperationId: 'kernel-1',
    verb: 'host.removeWorktree',
    status,
    stages,
    updatedAt: 0,
    ...(error ? { error } : {}),
  };
}

function scriptedSource(views: WorkspaceHostOperationView[]) {
  let index = 0;
  return {
    calls: () => index,
    getOperation: async (): Promise<
      Result<WorkspaceHostOperationView | null, { type: string; message: string }>
    > => {
      const next = views[Math.min(index, views.length - 1)];
      index += 1;
      return ok(next);
    },
  };
}

describe('followHostOperation', () => {
  it('folds the host stage stream into the desktop journal in order', async () => {
    const { ctx, journal } = fakeCtx();
    const source = scriptedSource([
      view('running', [
        { id: 'kill-sessions', label: 'Stop sessions', status: 'running' },
        { id: 'remove-worktree', label: 'Remove worktree', status: 'pending' },
      ]),
      view('running', [
        { id: 'kill-sessions', label: 'Stop sessions', status: 'succeeded' },
        { id: 'remove-worktree', label: 'Remove worktree', status: 'running' },
      ]),
      view('running', [
        { id: 'kill-sessions', label: 'Stop sessions', status: 'succeeded' },
        { id: 'remove-worktree', label: 'Remove worktree', status: 'succeeded' },
      ]),
      view('succeeded', [
        { id: 'kill-sessions', label: 'Stop sessions', status: 'succeeded' },
        { id: 'remove-worktree', label: 'Remove worktree', status: 'succeeded' },
      ]),
    ]);

    const result = await followHostOperation(ctx, source, {
      operationId: OPERATION_ID,
      clock: immediateClock(),
    });

    expect(result.status).toBe('succeeded');
    expect(journal).toEqual([
      { id: 'host:kill-sessions', label: 'Stop sessions', status: 'succeeded' },
      { id: 'host:remove-worktree', label: 'Remove worktree', status: 'succeeded' },
    ]);
  });

  it('treats skipped host stages as successful mirrors', async () => {
    const { ctx, journal } = fakeCtx();
    const source = scriptedSource([
      view('succeeded', [{ id: 'remove-worktree', label: 'Remove worktree', status: 'skipped' }]),
    ]);

    const result = await followHostOperation(ctx, source, {
      operationId: OPERATION_ID,
      clock: immediateClock(),
    });

    expect(result.status).toBe('succeeded');
    expect(journal).toEqual([
      { id: 'host:remove-worktree', label: 'Remove worktree', status: 'succeeded' },
    ]);
  });

  it('mirrors stages the desktop never predicted', async () => {
    const { ctx, journal } = fakeCtx();
    const source = scriptedSource([
      view('running', [{ id: 'kill-sessions', label: 'Stop sessions', status: 'succeeded' }]),
      view('succeeded', [
        { id: 'kill-sessions', label: 'Stop sessions', status: 'succeeded' },
        { id: 'remove-worktree:/w/hotfix', label: 'Remove worktree hotfix', status: 'succeeded' },
      ]),
    ]);

    await followHostOperation(ctx, source, {
      operationId: OPERATION_ID,
      clock: immediateClock(),
    });

    expect(journal.map((entry) => entry.id)).toEqual([
      'host:kill-sessions',
      'host:remove-worktree:/w/hotfix',
    ]);
  });

  it('throws HostStageFailedError when a host stage fails', async () => {
    const { ctx, journal } = fakeCtx();
    const source = scriptedSource([
      view('running', [
        {
          id: 'remove-worktree',
          label: 'Remove worktree',
          status: 'failed',
          error: { message: 'git worktree remove failed' },
        },
      ]),
    ]);

    await expect(
      followHostOperation(ctx, source, { operationId: OPERATION_ID, clock: immediateClock() })
    ).rejects.toThrow(HostStageFailedError);
    expect(journal).toEqual([
      { id: 'host:remove-worktree', label: 'Remove worktree', status: 'failed' },
    ]);
  });

  it('throws a retryable error when the host no longer knows the operation', async () => {
    const { ctx } = fakeCtx();
    const source = {
      getOperation: async (): Promise<
        Result<WorkspaceHostOperationView | null, { type: string; message: string }>
      > => ok(null),
    };

    await expect(
      followHostOperation(ctx, source, { operationId: OPERATION_ID, clock: immediateClock() })
    ).rejects.toMatchObject({ code: 'host-operation-missing' });
  });

  it('returns the terminal view when the operation fails without a failed stage', async () => {
    const { ctx, journal } = fakeCtx();
    const source = scriptedSource([
      view('failed', [{ id: 'kill-sessions', label: 'Stop sessions', status: 'succeeded' }], {
        type: 'git-command-failed',
        message: 'boom',
      }),
    ]);

    const result = await followHostOperation(ctx, source, {
      operationId: OPERATION_ID,
      clock: immediateClock(),
    });

    expect(result.status).toBe('failed');
    expect(journal).toEqual([
      { id: 'host:kill-sessions', label: 'Stop sessions', status: 'succeeded' },
    ]);
  });

  it('stops when the handler signal aborts', async () => {
    const { ctx, controller } = fakeCtx();
    const source = scriptedSource([
      view('running', [{ id: 'kill-sessions', label: 'Stop sessions', status: 'running' }]),
    ]);
    controller.abort();

    await expect(
      followHostOperation(ctx, source, { operationId: OPERATION_ID, clock: immediateClock() })
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});

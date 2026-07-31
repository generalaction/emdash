import type {
  WorkspaceOperationRecord,
  WorkspaceOperationRecordStatus,
} from '@emdash/core/runtimes/workspace/api';
import { describe, expect, it } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { operationChecklistByPath, workspaceOperationPanelRecords } from './use-machine-workspaces';

describe('operationChecklistByPath', () => {
  it('selects the newest non-terminal record for each workspace path', () => {
    const failed = operationRecord({
      requestId: 'failed',
      status: 'failed',
      updatedAt: 300,
    });
    const pending = operationRecord({
      requestId: 'pending',
      status: 'pending',
      updatedAt: 100,
    });
    const running = operationRecord({
      requestId: 'running',
      status: 'running',
      updatedAt: 200,
    });

    const selected = operationChecklistByPath({
      failed,
      pending,
      running,
    });

    expect(selected.get('/repo/worktree')?.requestId).toBe('running');
  });

  it('falls back to the newest failed record and ignores successful terminal records', () => {
    const oldFailed = operationRecord({
      requestId: 'old-failed',
      status: 'failed',
      updatedAt: 100,
    });
    const newFailed = operationRecord({
      requestId: 'new-failed',
      status: 'failed',
      updatedAt: 200,
    });
    const succeeded = operationRecord({
      requestId: 'succeeded',
      status: 'succeeded',
      updatedAt: 300,
    });

    const selected = operationChecklistByPath({
      oldFailed,
      newFailed,
      succeeded,
    });

    expect(selected.get('/repo/worktree')?.requestId).toBe('new-failed');
  });
});

describe('workspaceOperationPanelRecords', () => {
  const paths = new Set(['/repo/worktree']);

  it('keeps settled records regardless of age, deferring pruning to the host', () => {
    const recent = operationRecord({ requestId: 'recent', status: 'succeeded', updatedAt: 90_000 });
    const stale = operationRecord({ requestId: 'stale', status: 'succeeded', updatedAt: 20_000 });
    const running = operationRecord({ requestId: 'running', status: 'running', updatedAt: 0 });

    const visible = workspaceOperationPanelRecords({ recent, stale, running }, { paths });

    expect(visible.map((record) => record.requestId)).toEqual(['running', 'recent', 'stale']);
  });

  it('ignores records for workspaces the caller does not own', () => {
    const mine = operationRecord({ requestId: 'mine', status: 'running', updatedAt: 100 });
    const theirs = operationRecord({
      requestId: 'theirs',
      status: 'running',
      updatedAt: 100,
      path: '/other/worktree',
    });

    const visible = workspaceOperationPanelRecords({ mine, theirs }, { paths });

    expect(visible.map((record) => record.requestId)).toEqual(['mine']);
  });

  it('orders active work first, then failures, then completed work', () => {
    const succeeded = operationRecord({
      requestId: 'succeeded',
      status: 'succeeded',
      updatedAt: 400,
    });
    const failed = operationRecord({ requestId: 'failed', status: 'failed', updatedAt: 300 });
    const pending = operationRecord({ requestId: 'pending', status: 'pending', updatedAt: 200 });
    const running = operationRecord({ requestId: 'running', status: 'running', updatedAt: 100 });

    const visible = workspaceOperationPanelRecords(
      { succeeded, failed, pending, running },
      { paths }
    );

    expect(visible.map((record) => record.requestId)).toEqual([
      'running',
      'pending',
      'failed',
      'succeeded',
    ]);
  });

  it('keeps queued records in submission order', () => {
    const second = operationRecord({ requestId: 'second', status: 'pending', updatedAt: 100 });
    const first = operationRecord({ requestId: 'first', status: 'pending', updatedAt: 50 });

    const visible = workspaceOperationPanelRecords({ second, first }, { paths });

    expect(visible.map((record) => record.requestId)).toEqual(['first', 'second']);
  });
});

function operationRecord({
  requestId,
  status,
  updatedAt,
  path = '/repo/worktree',
}: {
  requestId: string;
  status: WorkspaceOperationRecordStatus;
  updatedAt: number;
  path?: string;
}): WorkspaceOperationRecord {
  const workspace = hostFileRefFromNativePath(path);
  return {
    requestId,
    seq: updatedAt,
    attempt: 0,
    kind: 'teardown',
    workspace,
    params: { kind: 'teardown', input: { workspace, force: false } },
    status,
    stages: {
      operationId: requestId,
      kind: 'teardown',
      stages: [{ id: 'teardown-plan', label: 'Remove workspace', status: 'done' }],
    },
    createdAt: updatedAt - 10,
    updatedAt,
    ...(status === 'failed'
      ? { error: { type: 'failed', message: 'Remove workspace failed' } }
      : {}),
    ...(status === 'succeeded' || status === 'failed' ? { finishedAt: updatedAt } : {}),
  };
}

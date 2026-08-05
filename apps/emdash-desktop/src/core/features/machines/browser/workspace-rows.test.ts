import type { OperationDisplayState, OperationTree } from '@emdash/core/primitives/operations/api';
import { describe, expect, it } from 'vitest';
import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import { joinWorkspaceRows } from './workspace-rows';

describe('joinWorkspaceRows', () => {
  it('joins usage, mirror git stats, and kernel operations into one row', () => {
    const joined = joinWorkspaceRows({
      rows: [workspaceRow()],
      usageResults: [
        {
          path: '/repo/task',
          success: true,
          usage: { totalBytes: 100, artifactBytes: 40, errors: [] },
        },
      ],
      operationTrees: [operationTree()],
    });

    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      key: 'workspace-1',
      status: 'tearing-down',
      usage: { totalBytes: 100 },
      gitStats: { added: 2 },
      operationBusy: true,
      operation: { node: { operationId: 'desktop-op' } },
    });
  });

  it('falls back to path identity and active-session status', () => {
    const row = { ...workspaceRow(), workspaceId: null, hasActiveSessions: true };
    const [joined] = joinWorkspaceRows({
      rows: [row],
      operationTrees: [],
    });

    expect(joined).toMatchObject({ key: row.path, status: 'active', operationBusy: false });
  });

  it('reports failed operations as errors with their message', () => {
    const failed: OperationDisplayState = {
      ...operationDisplay('desktop-op', '/repo/task'),
      status: 'failed',
      error: 'worktree removal failed',
    };
    const [joined] = joinWorkspaceRows({
      rows: [workspaceRow()],
      operationTrees: [
        { root: failed, children: [], rollup: { total: 1, done: 1, status: 'failed' } },
      ],
    });

    expect(joined).toMatchObject({
      status: 'error',
      operationErrorMessage: 'worktree removal failed',
      operationBusy: true,
    });
  });
});

function workspaceRow(): ProjectWorkspaceRow {
  return {
    kind: 'workspace',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    path: '/repo/task',
    branch: 'task',
    tasks: [],
    usage: null,
    gitStats: { added: 2, removed: 1, ahead: 1, behind: 0 },
    pathState: 'measured',
    canCleanArtifacts: true,
    canDelete: true,
    hasActiveSessions: false,
    errors: [],
  };
}

function operationTree(): OperationTree {
  const root = operationDisplay('root-op', '/repo');
  return {
    root,
    children: [operationDisplay('desktop-op', '/repo/task')],
    rollup: { total: 2, done: 0, status: 'running' },
  };
}

function operationDisplay(operationId: string, workspacePath: string): OperationDisplayState {
  return {
    operationId,
    operationKind: 'host-remove-worktree',
    displayName: 'Removing worktree',
    entityId: workspacePath,
    entityKind: 'workspace',
    hostRef: 'local:local',
    workspacePath,
    createdAt: 1,
    attempt: 0,
    status: 'running',
  };
}

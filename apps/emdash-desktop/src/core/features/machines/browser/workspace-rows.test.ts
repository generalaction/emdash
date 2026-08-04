import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { OperationDisplayState, OperationTree } from '@emdash/core/primitives/operations/api';
import { hostFileRef, parseAbsolute } from '@emdash/core/primitives/path/api';
import type { WorkspaceOperationRecord } from '@emdash/core/runtimes/workspace/api';
import { describe, expect, it } from 'vitest';
import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import { joinWorkspaceRows } from './workspace-rows';

describe('joinWorkspaceRows', () => {
  it('joins id-, path-, and host-path keyed state into one row', () => {
    const joined = joinWorkspaceRows({
      rows: [workspaceRow()],
      runtimeStatuses: new Map([
        ['workspace-1', { status: 'tearing-down', phase: 'tearing-down' }],
      ]),
      usageResults: [
        {
          path: '/repo/task',
          success: true,
          usage: { totalBytes: 100, artifactBytes: 40, errors: [] },
        },
      ],
      gitStatsResults: [
        {
          path: '/repo/task',
          success: true,
          stats: { added: 2, removed: 1, ahead: 1, behind: 0 },
        },
      ],
      operationTrees: [operationTree()],
      hostOperationRecords: { host: hostOperation() },
    });

    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      key: 'workspace-1',
      status: 'tearing-down',
      runtimePhase: 'tearing-down',
      usage: { totalBytes: 100 },
      gitStats: { added: 2 },
      operationBusy: true,
      operation: { node: { operationId: 'desktop-op' } },
      hostOperation: { requestId: 'host-op' },
    });
  });

  it('falls back to path identity and active-session status', () => {
    const row = { ...workspaceRow(), workspaceId: null, hasActiveSessions: true };
    const [joined] = joinWorkspaceRows({
      rows: [row],
      runtimeStatuses: new Map(),
      operationTrees: [],
      hostOperationRecords: {},
    });

    expect(joined).toMatchObject({ key: row.path, status: 'active', operationBusy: false });
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

function hostOperation(): WorkspaceOperationRecord {
  const path = parseAbsolute('/repo/task');
  if (!path.success) throw new Error(path.error.message);
  const workspace = hostFileRef(LOCAL_HOST_REF, path.data);
  return {
    requestId: 'host-op',
    seq: 1,
    attempt: 0,
    kind: 'teardown',
    workspace,
    params: { kind: 'teardown', input: { workspace, force: false } },
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
  };
}

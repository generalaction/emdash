import { ManualClock } from '@emdash/shared/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';
import {
  createArchiveWorkspaceOperationDefinition,
  createDeleteWorkspaceOperationDefinition,
} from './workspace-lifecycle-definitions';

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  resolveTargets: vi.fn(),
  workspaceIsUnused: vi.fn(),
  purgeWorkspaceRow: vi.fn(),
}));
const dependencies = {
  cleanup: {} as never,
  lifecycleContext: {} as never,
  sessions: {
    resolve: mocks.resolveTargets,
    killAcp: vi.fn(),
    killTerminals: vi.fn(),
  },
};

vi.mock('@core/features/workspaces/api/node/operations/lifecycle-operation-context', () => ({
  resolveLifecycleOperationContext: mocks.resolveContext,
}));

vi.mock('@core/features/workspaces/api/node/operations/lifecycle-cleanup', () => ({
  cleanLifecycleWorkspaceArtifacts: vi.fn(),
  deactivateLifecycleWorkspace: vi.fn(),
  lifecycleWorkspaceIsDirty: vi.fn(async () => false),
  lifecycleWorkspaceIsUnused: mocks.workspaceIsUnused,
  purgeLifecycleWorkspaceRow: mocks.purgeWorkspaceRow,
  teardownLifecycleWorkspace: vi.fn(),
}));

describe('workspace operation definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveContext.mockResolvedValue({ preservePatterns: [] });
    mocks.resolveTargets.mockResolvedValue({
      acpConversationIds: [],
      tuiConversationIds: [],
      terminalSessionIds: [],
      tmuxSessionNames: [],
    });
    mocks.workspaceIsUnused.mockResolvedValue(true);
    mocks.purgeWorkspaceRow.mockResolvedValue(undefined);
  });

  it('fails a delete before effects when the workspace is in use', async () => {
    mocks.workspaceIsUnused.mockResolvedValue(false);

    const result = await createDeleteWorkspaceOperationDefinition(dependencies).run(
      runContext(operation('delete-workspace'))
    );

    expect(result).toEqual({
      success: false,
      error: {
        type: 'failed',
        code: 'workspace-in-use',
        message: 'Workspace is still referenced by an active task.',
        retryable: false,
      },
    });
    expect(mocks.resolveTargets).not.toHaveBeenCalled();
  });

  it('converges an archive when only the final row purge remains', async () => {
    const result = await createArchiveWorkspaceOperationDefinition(dependencies).run(
      runContext(operation('archive-workspace'))
    );

    expect(result).toEqual({ success: true, data: undefined });
    expect(mocks.purgeWorkspaceRow).toHaveBeenCalledTimes(1);
  });
});

function runContext(operationRow: LifecycleOperationRow) {
  return {
    operation: operationRow,
    db: {} as never,
    signal: new AbortController().signal,
    clock: new ManualClock(),
    reportProgress: vi.fn(),
  };
}

function operation(kind: 'delete-workspace' | 'archive-workspace'): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind,
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
}

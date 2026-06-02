import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '@main/db/schema';
import type { WorkspaceConfig } from '@shared/workspace-config';
import { serializeWorkspaceConfig } from '@shared/workspace-config';
import { createTask } from './createTask';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProject,
  },
}));

function makeTaskRow(values: Partial<TaskRow>): TaskRow {
  return {
    id: values.id ?? 'task-1',
    projectId: values.projectId ?? 'project-1',
    name: values.name ?? 'Test Task',
    status: values.status ?? 'in_progress',
    sourceBranch: values.sourceBranch ?? null,
    taskBranch: values.taskBranch ?? null,
    linkedIssue: values.linkedIssue ?? null,
    archivedAt: values.archivedAt ?? null,
    createdAt: values.createdAt ?? '2026-05-18 12:00:00',
    updatedAt: values.updatedAt ?? '2026-05-18 12:00:00',
    lastInteractedAt: values.lastInteractedAt ?? null,
    statusChangedAt: values.statusChangedAt ?? '2026-05-18 12:00:00',
    isPinned: values.isPinned ?? 0,
    workspaceProvider: values.workspaceProvider ?? null,
    workspaceId: values.workspaceId ?? null,
    workspaceProviderData: values.workspaceProviderData ?? null,
    workspaceIntent: values.workspaceIntent ?? null,
  };
}

/**
 * Sets up db.transaction to invoke the callback with a fake `tx`.
 * The fake tx captures insert values by call order (0=task, 1=workspace, 2=conversation).
 * Returns an array that is populated with each set of insert values as the callback runs.
 */
function setupTransactionMock() {
  const captured: unknown[] = [];

  mocks.transaction.mockImplementation((cb: (tx: unknown) => void) => {
    captured.length = 0;
    cb({
      insert: () => ({
        values: (vals: unknown) => {
          captured.push(vals);
          return {
            returning: () => ({ all: () => [makeTaskRow(vals as Partial<TaskRow>)] }),
            run: () => {},
          };
        },
      }),
    });
  });

  return { captured };
}

describe('createTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockReturnValue({});
    setupTransactionMock();
  });

  it('returns project-not-found when project does not exist', async () => {
    mocks.getProject.mockReturnValue(undefined);
    const result = await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      workspaceConfig: { version: '1', git: { kind: 'none' }, workspace: { host: 'local' } },
    });
    expect(result).toEqual({ success: false, error: { type: 'project-not-found' } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('executes all writes inside a single db.transaction call', async () => {
    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      workspaceConfig: { version: '1', git: { kind: 'none' }, workspace: { host: 'local' } },
    });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('stores WorkspaceConfig JSON in workspaces.config', async () => {
    const { captured } = setupTransactionMock();
    const workspaceConfig: WorkspaceConfig = {
      version: '1',
      git: {
        kind: 'create-branch',
        branchName: 'feature/test',
        fromBranch: { type: 'local' as const, branch: 'main' },
        pushBranch: true,
      },
      workspace: { host: 'local' },
    };

    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      workspaceConfig,
    });

    // captured[0] = task insert, captured[1] = workspace insert
    expect(captured[1]).toEqual(
      expect.objectContaining({ config: serializeWorkspaceConfig(workspaceConfig) })
    );
  });

  it('does not write taskBranch or sourceBranch to the tasks row', async () => {
    const { captured } = setupTransactionMock();

    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      workspaceConfig: {
        version: '1',
        git: {
          kind: 'create-branch',
          branchName: 'feature/x',
          fromBranch: { type: 'local', branch: 'main' },
        },
        workspace: { host: 'local' },
      },
    });

    // captured[0] = task insert
    expect(captured[0]).not.toEqual(
      expect.objectContaining({ taskBranch: expect.anything(), sourceBranch: expect.anything() })
    );
  });

  it('includes workspaceId in the task row insert (no separate UPDATE)', async () => {
    const { captured } = setupTransactionMock();

    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      workspaceConfig: { version: '1', git: { kind: 'none' }, workspace: { host: 'local' } },
    });

    const taskInsert = captured[0] as Record<string, unknown>;
    expect(taskInsert.workspaceId).toBeDefined();
    expect(typeof taskInsert.workspaceId).toBe('string');
  });

  describe('workspace row type from workspaceConfig.workspace.host', () => {
    it('creates a local workspace row for host:local', async () => {
      const { captured } = setupTransactionMock();
      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        workspaceConfig: { version: '1', git: { kind: 'none' }, workspace: { host: 'local' } },
      });
      expect((captured[1] as Record<string, unknown>).type).toBe('local');
    });

    it('creates a project-ssh workspace row for host:project-ssh', async () => {
      const { captured } = setupTransactionMock();
      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        workspaceConfig: {
          version: '1',
          git: { kind: 'none' },
          workspace: { host: 'project-ssh' },
        },
      });
      expect((captured[1] as Record<string, unknown>).type).toBe('project-ssh');
    });

    it('creates a byoi workspace row for host:byoi', async () => {
      const { captured } = setupTransactionMock();
      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        workspaceConfig: { version: '1', git: { kind: 'none' }, workspace: { host: 'byoi' } },
      });
      expect((captured[1] as Record<string, unknown>).type).toBe('byoi');
    });
  });
});

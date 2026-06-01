import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '@main/db/schema';
import { toStoredBranch } from '../stored-branch';
import { createTask } from './createTask';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  getProject: vi.fn(),
  resolveProviderRepository: vi.fn(),
  getTaskPullRequests: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProject,
  },
}));

vi.mock('../../pull-requests/pr-query-service', () => ({
  prQueryService: {
    getTaskPullRequests: mocks.getTaskPullRequests,
  },
}));

vi.mock('@main/core/repository/provider-repository-service', () => ({
  providerRepositoryService: {
    resolveProject: mocks.resolveProviderRepository,
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

describe('createTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getProject.mockReturnValue({});
    mocks.resolveProviderRepository.mockResolvedValue({
      success: false,
      error: { type: 'unsupported_provider' },
    });
    mocks.getTaskPullRequests.mockResolvedValue([]);

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    mocks.update.mockReturnValue({ set: updateSet });
  });

  function setupInsertMocks(taskRowOverrides: Partial<TaskRow> = {}) {
    const insertTaskValues = vi.fn((values: Partial<TaskRow>) => ({
      returning: vi.fn().mockResolvedValue([makeTaskRow({ ...values, ...taskRowOverrides })]),
    }));
    const insertWorkspaceValues = vi.fn().mockResolvedValue(undefined);
    mocks.insert
      .mockReturnValueOnce({ values: insertTaskValues })
      .mockReturnValueOnce({ values: insertWorkspaceValues });
    return { insertTaskValues, insertWorkspaceValues };
  }

  it('returns project-not-found when project does not exist', async () => {
    mocks.getProject.mockReturnValue(undefined);
    const result = await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      gitSetup: { kind: 'none' },
      workspaceLocation: { host: 'local' },
    });
    expect(result).toEqual({ success: false, error: { type: 'project-not-found' } });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('stores workspace_intent JSON with gitSetup and workspaceLocation', async () => {
    const { insertTaskValues } = setupInsertMocks();
    const gitSetup = {
      kind: 'create-branch' as const,
      branchName: 'feature/test',
      fromBranch: { type: 'local' as const, branch: 'main' },
      pushBranch: true,
    };
    const workspaceLocation = { host: 'local' as const };

    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      gitSetup,
      workspaceLocation,
    });

    expect(insertTaskValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceIntent: JSON.stringify({ git: gitSetup, workspace: workspaceLocation }),
      })
    );
  });

  describe('deriveDbColumns — taskBranch and sourceBranch', () => {
    it('stores no taskBranch or sourceBranch for gitSetup.none', async () => {
      const { insertTaskValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        gitSetup: { kind: 'none' },
        workspaceLocation: { host: 'local' },
      });

      expect(insertTaskValues).toHaveBeenCalledWith(
        expect.objectContaining({ taskBranch: undefined, sourceBranch: toStoredBranch(undefined) })
      );
    });

    it('stores branchName as taskBranch and fromBranch as sourceBranch for create-branch', async () => {
      const { insertTaskValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        gitSetup: {
          kind: 'create-branch',
          branchName: 'feature/my-task',
          fromBranch: { type: 'local', branch: 'main' },
          pushBranch: false,
        },
        workspaceLocation: { host: 'local' },
      });

      expect(insertTaskValues).toHaveBeenCalledWith(
        expect.objectContaining({
          taskBranch: 'feature/my-task',
          sourceBranch: toStoredBranch({ type: 'local', branch: 'main' }),
        })
      );
    });

    it('stores branchName as taskBranch and itself as sourceBranch for use-branch', async () => {
      const { insertTaskValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        gitSetup: { kind: 'use-branch', branchName: 'existing-branch' },
        workspaceLocation: { host: 'local' },
      });

      expect(insertTaskValues).toHaveBeenCalledWith(
        expect.objectContaining({
          taskBranch: 'existing-branch',
          sourceBranch: toStoredBranch({ type: 'local', branch: 'existing-branch' }),
        })
      );
    });

    it('stores headBranch as taskBranch and as sourceBranch for pr-branch without taskBranch', async () => {
      const { insertTaskValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Review PR',
        gitSetup: {
          kind: 'pr-branch',
          prNumber: 123,
          headBranch: 'feature/pr-head',
          headRepositoryUrl: 'https://github.com/example/repo.git',
          isFork: false,
        },
        workspaceLocation: { host: 'local' },
      });

      expect(insertTaskValues).toHaveBeenCalledWith(
        expect.objectContaining({
          taskBranch: 'feature/pr-head',
          sourceBranch: toStoredBranch({ type: 'local', branch: 'feature/pr-head' }),
        })
      );
    });

    it('stores taskBranch override when provided in pr-branch', async () => {
      const { insertTaskValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Review PR',
        gitSetup: {
          kind: 'pr-branch',
          prNumber: 123,
          headBranch: 'feature/pr-head',
          headRepositoryUrl: 'https://github.com/example/repo.git',
          isFork: false,
          taskBranch: 'my-review-branch',
        },
        workspaceLocation: { host: 'local' },
      });

      expect(insertTaskValues).toHaveBeenCalledWith(
        expect.objectContaining({
          taskBranch: 'my-review-branch',
          sourceBranch: toStoredBranch({ type: 'local', branch: 'feature/pr-head' }),
        })
      );
    });
  });

  describe('workspace row type from workspaceLocation.host', () => {
    it('creates a local workspace row for host:local', async () => {
      const { insertWorkspaceValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        gitSetup: { kind: 'none' },
        workspaceLocation: { host: 'local' },
      });

      expect(insertWorkspaceValues).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'local' })
      );
    });

    it('creates a project-ssh workspace row for host:project-ssh', async () => {
      const { insertWorkspaceValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        gitSetup: { kind: 'none' },
        workspaceLocation: { host: 'project-ssh' },
      });

      expect(insertWorkspaceValues).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'project-ssh' })
      );
    });

    it('creates a byoi workspace row for host:byoi', async () => {
      const { insertWorkspaceValues } = setupInsertMocks();

      await createTask({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Test Task',
        gitSetup: { kind: 'none' },
        workspaceLocation: { host: 'byoi' },
      });

      expect(insertWorkspaceValues).toHaveBeenCalledWith(expect.objectContaining({ type: 'byoi' }));
    });
  });

  it('queries PR metadata when gitSetup is pr-branch', async () => {
    setupInsertMocks();
    mocks.resolveProviderRepository.mockResolvedValue({
      success: true,
      data: { repositoryUrl: 'https://github.com/example/repo.git' },
    });
    mocks.getTaskPullRequests.mockResolvedValue([]);

    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Review PR',
      gitSetup: {
        kind: 'pr-branch',
        prNumber: 42,
        headBranch: 'feature/pr',
        headRepositoryUrl: 'https://github.com/example/repo.git',
        isFork: false,
      },
      workspaceLocation: { host: 'local' },
    });

    expect(mocks.getTaskPullRequests).toHaveBeenCalledWith(
      'project-1',
      'feature/pr',
      'https://github.com/example/repo.git'
    );
  });

  it('skips PR metadata query for non-PR gitSetup kinds', async () => {
    setupInsertMocks();

    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Test Task',
      gitSetup: {
        kind: 'create-branch',
        branchName: 'feature/x',
        fromBranch: { type: 'local', branch: 'main' },
      },
      workspaceLocation: { host: 'local' },
    });

    expect(mocks.getTaskPullRequests).not.toHaveBeenCalled();
  });
});

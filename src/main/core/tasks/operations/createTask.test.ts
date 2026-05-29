import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '@main/db/schema';
import { err } from '@shared/result';
import { DEFAULT_TASK_KIND, TASK_KIND } from '@shared/tasks';
import { toStoredBranch } from '../stored-branch';
import { createTask } from './createTask';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  getProject: vi.fn(),
  getAppSetting: vi.fn(),
  resolveProviderRepository: vi.fn(),
  getTaskPullRequests: vi.fn(),
  findBranchAnywhere: vi.fn(),
  fetchPrForReview: vi.fn(),
  getConfiguredRemotes: vi.fn(),
  getRepositoryInfo: vi.fn(),
  createBranch: vi.fn(),
  publishBranch: vi.fn(),
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

vi.mock('../../settings/settings-service', () => ({
  appSettingsService: {
    get: mocks.getAppSetting,
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
    name: values.name ?? 'Review PR',
    kind: values.kind ?? DEFAULT_TASK_KIND,
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
  };
}

describe('createTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getAppSetting.mockImplementation((key: string) => {
      if (key === 'project') {
        return Promise.resolve({ branchPrefix: 'emdash', appendRandomBranchSuffix: true });
      }
      return Promise.resolve(undefined);
    });

    mocks.findBranchAnywhere.mockResolvedValue('/external/worktrees/pr-branch');
    mocks.fetchPrForReview.mockResolvedValue({ success: true });
    mocks.getConfiguredRemotes.mockResolvedValue({ baseRemote: 'origin', pushRemote: 'origin' });
    mocks.getRepositoryInfo.mockResolvedValue({ isUnborn: false, currentBranch: 'main' });
    mocks.createBranch.mockResolvedValue({ success: true, data: undefined });
    mocks.publishBranch.mockResolvedValue({ success: true, data: { output: '' } });
    mocks.getProject.mockReturnValue({
      defaultWorkspaceType: { kind: 'local' },
      worktreeService: {
        findBranchAnywhere: mocks.findBranchAnywhere,
      },
      repository: {
        getConfiguredRemotes: mocks.getConfiguredRemotes,
        getRepositoryInfo: mocks.getRepositoryInfo,
        createBranch: mocks.createBranch,
        publishBranch: mocks.publishBranch,
        fetchPrForReview: mocks.fetchPrForReview,
      },
    });
    mocks.resolveProviderRepository.mockResolvedValue(err({ type: 'unsupported_provider' }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    mocks.update.mockReturnValue({ set: updateSet });
  });

  it('skips fetching a pull request branch that is already checked out in any worktree', async () => {
    const insertTaskValues = vi.fn((values: Partial<TaskRow>) => ({
      returning: vi.fn().mockResolvedValue([makeTaskRow(values)]),
    }));
    const insertWorkspaceValues = vi.fn().mockResolvedValue(undefined);
    mocks.insert
      .mockReturnValueOnce({ values: insertTaskValues })
      .mockReturnValueOnce({ values: insertWorkspaceValues });

    const result = await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Review PR',
      sourceBranch: {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'https://github.com/example/repo.git' },
      },
      strategy: {
        kind: 'from-pull-request',
        prNumber: 123,
        headBranch: 'claude/add-french-translations-ud2fs',
        headRepositoryUrl: 'https://github.com/example/repo.git',
        isFork: false,
      },
    });

    expect(result.success).toBe(true);
    expect(mocks.findBranchAnywhere).toHaveBeenCalledWith('claude/add-french-translations-ud2fs');
    expect(mocks.fetchPrForReview).not.toHaveBeenCalled();
    expect(insertTaskValues).toHaveBeenCalledWith(
      expect.objectContaining({
        taskBranch: 'claude/add-french-translations-ud2fs',
        sourceBranch: toStoredBranch({
          type: 'local',
          branch: 'claude/add-french-translations-ud2fs',
        }),
      })
    );
  });

  it('fetches the pull request branch when it is not already checked out', async () => {
    mocks.findBranchAnywhere.mockResolvedValue(undefined);

    const insertTaskValues = vi.fn((values: Partial<TaskRow>) => ({
      returning: vi.fn().mockResolvedValue([makeTaskRow(values)]),
    }));
    const insertWorkspaceValues = vi.fn().mockResolvedValue(undefined);
    mocks.insert
      .mockReturnValueOnce({ values: insertTaskValues })
      .mockReturnValueOnce({ values: insertWorkspaceValues });

    const result = await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Review PR',
      sourceBranch: {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'https://github.com/example/repo.git' },
      },
      strategy: {
        kind: 'from-pull-request',
        prNumber: 123,
        headBranch: 'claude/add-french-translations-ud2fs',
        headRepositoryUrl: 'https://github.com/example/repo.git',
        isFork: false,
      },
    });

    expect(result.success).toBe(true);
    expect(mocks.findBranchAnywhere).toHaveBeenCalledWith('claude/add-french-translations-ud2fs');
    expect(mocks.fetchPrForReview).toHaveBeenCalledWith(
      123,
      'claude/add-french-translations-ud2fs',
      'https://github.com/example/repo.git',
      'claude/add-french-translations-ud2fs',
      false,
      'origin'
    );
    expect(insertTaskValues).toHaveBeenCalledWith(
      expect.objectContaining({
        taskBranch: 'claude/add-french-translations-ud2fs',
        sourceBranch: toStoredBranch({
          type: 'local',
          branch: 'claude/add-french-translations-ud2fs',
        }),
      })
    );
  });

  it('inserts kind="chat" with no worktree when requested', async () => {
    const insertTaskValues = vi.fn((values: Partial<TaskRow>) => ({
      returning: vi.fn().mockResolvedValue([makeTaskRow(values)]),
    }));
    const insertWorkspaceValues = vi.fn().mockResolvedValue(undefined);
    mocks.insert
      .mockReturnValueOnce({ values: insertTaskValues })
      .mockReturnValueOnce({ values: insertWorkspaceValues });

    const result = await createTask({
      id: 'chat-1',
      projectId: 'project-1',
      name: 'chat-may-27',
      kind: TASK_KIND.Chat,
      sourceBranch: { type: 'local', branch: 'main' },
      strategy: { kind: 'no-worktree' },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.task.kind).toBe(TASK_KIND.Chat);
    expect(insertTaskValues).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: TASK_KIND.Chat,
        taskBranch: undefined,
      })
    );
  });

  it('defaults kind to "task" when not provided', async () => {
    const insertTaskValues = vi.fn((values: Partial<TaskRow>) => ({
      returning: vi.fn().mockResolvedValue([makeTaskRow(values)]),
    }));
    const insertWorkspaceValues = vi.fn().mockResolvedValue(undefined);
    mocks.insert
      .mockReturnValueOnce({ values: insertTaskValues })
      .mockReturnValueOnce({ values: insertWorkspaceValues });

    await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Review PR',
      sourceBranch: { type: 'local', branch: 'main' },
      strategy: {
        kind: 'from-pull-request',
        prNumber: 123,
        headBranch: 'feature',
        headRepositoryUrl: 'https://github.com/example/repo.git',
        isFork: false,
      },
    });

    expect(insertTaskValues).toHaveBeenCalledWith(expect.objectContaining({ kind: TASK_KIND.Task }));
  });

  it('creates a regular no-worktree task with kind task and no branch', async () => {
    const insertTaskValues = vi.fn((values: Partial<TaskRow>) => ({
      returning: vi.fn().mockResolvedValue([makeTaskRow(values)]),
    }));
    const insertWorkspaceValues = vi.fn().mockResolvedValue(undefined);
    mocks.insert
      .mockReturnValueOnce({ values: insertTaskValues })
      .mockReturnValueOnce({ values: insertWorkspaceValues });

    const result = await createTask({
      id: 'blank-1',
      projectId: 'project-1',
      name: 'Blank task',
      sourceBranch: { type: 'local', branch: 'main' },
      strategy: { kind: 'no-worktree' },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.task.kind).toBe(TASK_KIND.Task);
    expect(insertTaskValues).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: TASK_KIND.Task,
        taskBranch: undefined,
      })
    );
  });

  it('creates branch-based tasks from local source branches without remote sync', async () => {
    const insertTaskValues = vi.fn((values: Partial<TaskRow>) => ({
      returning: vi.fn().mockResolvedValue([makeTaskRow(values)]),
    }));
    const insertWorkspaceValues = vi.fn().mockResolvedValue(undefined);
    mocks.insert
      .mockReturnValueOnce({ values: insertTaskValues })
      .mockReturnValueOnce({ values: insertWorkspaceValues });

    const result = await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Local task',
      sourceBranch: { type: 'local', branch: 'main' },
      strategy: {
        kind: 'new-branch',
        taskBranch: 'task/local',
        pushBranch: false,
      },
    });

    expect(result.success).toBe(true);
    expect(mocks.createBranch).toHaveBeenCalledWith('task/local', 'main', false, undefined);
  });

  it('blocks branch-based tasks when the selected remote source branch cannot be fetched', async () => {
    mocks.createBranch.mockResolvedValueOnce(
      err({
        type: 'fetch_failed',
        remote: 'origin',
        branch: 'main',
        error: {
          type: 'auth_failed',
          message:
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        },
      })
    );

    const result = await createTask({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Remote task',
      sourceBranch: {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'https://github.com/example/repo.git' },
      },
      strategy: {
        kind: 'new-branch',
        taskBranch: 'task/remote',
        pushBranch: false,
      },
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'branch-create-failed',
        branch: 'task/remote',
        error: {
          type: 'fetch_failed',
          remote: 'origin',
          branch: 'main',
          error: {
            type: 'auth_failed',
            message:
              "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
          },
        },
      },
    });
    expect(mocks.createBranch).toHaveBeenCalledWith('task/remote', 'main', true, 'origin');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

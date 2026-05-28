import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '@main/db/schema';
import { err } from '@shared/result';
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
    mocks.getProject.mockReturnValue({
      defaultWorkspaceType: { kind: 'local' },
      worktreeService: {
        findBranchAnywhere: mocks.findBranchAnywhere,
      },
      repository: {
        getConfiguredRemotes: mocks.getConfiguredRemotes,
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
});

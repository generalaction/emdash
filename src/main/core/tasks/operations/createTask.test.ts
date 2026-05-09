import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask } from './createTask';

const mocks = vi.hoisted(() => ({
  getProjectMock: vi.fn(),
  provisionTaskMock: vi.fn(),
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  returningMock: vi.fn(),
  getConfiguredRemoteMock: vi.fn(),
  createBranchMock: vi.fn(),
  publishBranchMock: vi.fn(),
  fetchPrForReviewMock: vi.fn(),
  getRepositoryInfoMock: vi.fn(),
  getWorktreeForBranchMock: vi.fn(),
  appSettingsGetMock: vi.fn(),
  prGetTaskPullRequestsMock: vi.fn(),
  prGetProjectRemoteInfoMock: vi.fn(),
  taskEventsEmitMock: vi.fn(),
  telemetryCaptureMock: vi.fn(),
  createConversationMock: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProjectMock },
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: { provisionTask: mocks.provisionTaskMock },
}));

vi.mock('@main/db/client', () => ({
  db: { insert: mocks.insertMock },
}));

vi.mock('@main/db/schema', () => ({
  tasks: {},
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.telemetryCaptureMock },
}));

vi.mock('../../settings/settings-service', () => ({
  appSettingsService: { get: mocks.appSettingsGetMock },
}));

vi.mock('../../pull-requests/pr-query-service', () => ({
  prQueryService: {
    getTaskPullRequests: mocks.prGetTaskPullRequestsMock,
    getProjectRemoteInfo: mocks.prGetProjectRemoteInfoMock,
  },
}));

vi.mock('@main/core/tasks/task-events', () => ({
  taskEvents: { _emit: mocks.taskEventsEmitMock },
}));

vi.mock('../../conversations/createConversation', () => ({
  createConversation: mocks.createConversationMock,
}));

vi.mock('../utils/utils', () => ({
  mapTaskRowToTask: (row: unknown) => row,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertMock.mockReturnValue({ values: mocks.valuesMock });
  mocks.valuesMock.mockReturnValue({ returning: mocks.returningMock });
  mocks.appSettingsGetMock.mockImplementation(async (key: string) => {
    if (key === 'localProject') return { branchPrefix: '' };
    return {};
  });
  mocks.provisionTaskMock.mockResolvedValue({ success: true, value: undefined });
  mocks.prGetProjectRemoteInfoMock.mockResolvedValue({ status: 'unavailable' });
});

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-id',
    isGitRepo: true,
    repository: {
      getConfiguredRemote: mocks.getConfiguredRemoteMock,
      createBranch: mocks.createBranchMock,
      publishBranch: mocks.publishBranchMock,
      fetchPrForReview: mocks.fetchPrForReviewMock,
      getRepositoryInfo: mocks.getRepositoryInfoMock,
    },
    getWorktreeForBranch: mocks.getWorktreeForBranchMock,
    ...overrides,
  };
}

describe('createTask — non-git project', () => {
  it('forces no-worktree strategy and skips repository operations', async () => {
    mocks.getProjectMock.mockReturnValue(makeProject({ isGitRepo: false }));
    mocks.returningMock.mockResolvedValue([
      {
        id: 'task-id',
        projectId: 'project-id',
        name: 'Task',
        taskBranch: null,
        sourceBranch: null,
      },
    ]);

    const result = await createTask({
      id: 'task-id',
      projectId: 'project-id',
      name: 'Task',
      // Caller passed a branch strategy — should be ignored for non-git.
      strategy: { kind: 'new-branch', taskBranch: 'feature/should-be-ignored' },
      sourceBranch: { type: 'local', branch: 'main' },
    });

    expect(result.success).toBe(true);
    expect(mocks.getConfiguredRemoteMock).not.toHaveBeenCalled();
    expect(mocks.createBranchMock).not.toHaveBeenCalled();
    expect(mocks.publishBranchMock).not.toHaveBeenCalled();
    expect(mocks.fetchPrForReviewMock).not.toHaveBeenCalled();
    expect(mocks.getRepositoryInfoMock).not.toHaveBeenCalled();
    expect(mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-id',
        taskBranch: undefined,
        sourceBranch: null,
      })
    );
    expect(mocks.telemetryCaptureMock).toHaveBeenCalledWith(
      'task_created',
      expect.objectContaining({ strategy: 'blank' })
    );
  });

  it('does not consult getConfiguredRemote even when callers request push', async () => {
    mocks.getProjectMock.mockReturnValue(makeProject({ isGitRepo: false }));
    mocks.returningMock.mockResolvedValue([
      { id: 'task-id', projectId: 'project-id', name: 'T', taskBranch: null, sourceBranch: null },
    ]);

    await createTask({
      id: 'task-id',
      projectId: 'project-id',
      name: 'T',
      strategy: { kind: 'new-branch', taskBranch: 'x', pushBranch: true },
      sourceBranch: { type: 'local', branch: 'main' },
    });

    expect(mocks.getConfiguredRemoteMock).not.toHaveBeenCalled();
    expect(mocks.publishBranchMock).not.toHaveBeenCalled();
  });
});

describe('createTask — missing source branch', () => {
  it('returns provision-failed for checkout-existing instead of an empty branch-not-found', async () => {
    mocks.getProjectMock.mockReturnValue(makeProject());

    const result = await createTask({
      id: 'task-id',
      projectId: 'project-id',
      name: 'T',
      strategy: { kind: 'checkout-existing' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('provision-failed');
    }
  });

  it('returns provision-failed for new-branch instead of branch-not-found', async () => {
    mocks.getProjectMock.mockReturnValue(makeProject());

    const result = await createTask({
      id: 'task-id',
      projectId: 'project-id',
      name: 'T',
      strategy: { kind: 'new-branch', taskBranch: 'feature/new' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        type: 'provision-failed',
        message: 'Cannot create a new branch without a source branch.',
      });
    }
  });
});

describe('createTask — getConfiguredRemote is lazy', () => {
  it('does not call getConfiguredRemote for the no-worktree strategy on a git project', async () => {
    mocks.getProjectMock.mockReturnValue(makeProject());
    mocks.returningMock.mockResolvedValue([
      { id: 'task-id', projectId: 'project-id', name: 'T', taskBranch: null, sourceBranch: null },
    ]);

    await createTask({
      id: 'task-id',
      projectId: 'project-id',
      name: 'T',
      strategy: { kind: 'no-worktree' },
    });

    expect(mocks.getConfiguredRemoteMock).not.toHaveBeenCalled();
  });
});

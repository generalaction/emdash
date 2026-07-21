import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTaskResourceTeardown } from '../task-resource-teardown-state';
import { teardownTaskResources } from './teardownTaskResources';

const mocks = vi.hoisted(() => ({
  cleanupDetachedTaskSessions: vi.fn(),
  getProject: vi.fn(),
  getTask: vi.fn(),
  selectLimit: vi.fn(),
  teardownStoredWorkspace: vi.fn(),
  teardownTask: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  cleanupDetachedTaskSessions: mocks.cleanupDetachedTaskSessions,
  taskSessionManager: {
    getTask: mocks.getTask,
    teardownTask: mocks.teardownTask,
  },
}));

vi.mock('@main/core/workspaces/teardown-stored-workspace', () => ({
  teardownStoredWorkspace: mocks.teardownStoredWorkspace,
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.selectLimit }),
      }),
    }),
  },
}));

const task = {
  id: 'task-1',
  projectId: 'project-1',
  name: 'Task 1',
  workspaceId: 'workspace-1',
};

describe('teardownTaskResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cleanupDetachedTaskSessions.mockResolvedValue(undefined);
    mocks.teardownStoredWorkspace.mockResolvedValue({ success: true, data: true });
    mocks.teardownTask.mockResolvedValue({ success: true });
  });

  it('uses the mounted task provider when the task is live', async () => {
    mocks.getTask.mockReturnValue({ taskId: 'task-1' });

    await expect(teardownTaskResources(task, 'archive')).resolves.toEqual({ success: true });

    expect(mocks.teardownTask).toHaveBeenCalledWith('task-1', 'archive');
    expect(mocks.teardownStoredWorkspace).not.toHaveBeenCalled();
  });

  it('reaps detached sessions and reopens a cold workspace only for teardown', async () => {
    const coldTask = { ...task, id: 'task-cold' };
    const project = { ctx: {}, projectId: 'project-1' };
    const workspace = {
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      path: '/tmp/worktree',
    };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(project);
    mocks.selectLimit.mockResolvedValue([workspace]);

    await expect(teardownTaskResources(coldTask, 'terminate')).resolves.toEqual({ success: true });

    expect(mocks.cleanupDetachedTaskSessions).toHaveBeenCalledWith(
      'project-1',
      'task-cold',
      project.ctx
    );
    expect(mocks.teardownStoredWorkspace).toHaveBeenCalledWith({
      task: coldTask,
      workspace,
      project,
      mode: 'terminate',
    });
  });

  it('runs provider-only cold cleanup after archive without repeating lifecycle teardown', async () => {
    const archivedTask = { ...task, id: 'task-idempotent' };
    const project = { ctx: {}, projectId: 'project-1' };
    const workspace = {
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      path: '/tmp/worktree',
    };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(project);
    mocks.selectLimit.mockResolvedValue([workspace]);

    await teardownTaskResources(archivedTask, 'archive');
    await teardownTaskResources(archivedTask, 'terminate');

    expect(mocks.cleanupDetachedTaskSessions).toHaveBeenCalledTimes(2);
    expect(mocks.teardownStoredWorkspace).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: 'archive' })
    );
    expect(mocks.teardownStoredWorkspace).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'terminate-provider' })
    );
  });

  it('uses the archive marker after restart to run provider-only cold delete cleanup', async () => {
    const restartedTask = {
      ...task,
      id: 'task-restarted',
      lifecycleTeardownAt: '2026-07-16T07:00:00.000Z',
    };
    const project = { ctx: {}, projectId: 'project-1' };
    const workspace = {
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      path: '/tmp/worktree',
    };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(project);
    mocks.selectLimit.mockResolvedValue([workspace]);

    await expect(teardownTaskResources(restartedTask, 'terminate')).resolves.toEqual({
      success: true,
    });

    expect(mocks.teardownStoredWorkspace).toHaveBeenCalledWith({
      task: restartedTask,
      workspace,
      project,
      mode: 'terminate-provider',
    });
  });

  it.each([
    ['local', 'local'],
    ['SSH', 'project-ssh'],
    ['BYOI', 'byoi'],
  ])(
    'skips completed lifecycle and provider phases after %s shutdown and restart',
    async (label, workspaceType) => {
      const restartedTask = {
        ...task,
        id: `task-restarted-${label}`,
        lifecycleTeardownAt: '2026-07-16T07:00:00.000Z',
        providerDestroyAt: '2026-07-16T07:00:00.000Z',
        workspaceType,
      };
      mocks.getTask.mockReturnValue(undefined);
      mocks.getProject.mockReturnValue(undefined);

      await expect(teardownTaskResources(restartedTask, 'terminate')).resolves.toEqual({
        success: true,
      });

      expect(mocks.getProject).not.toHaveBeenCalled();
      expect(mocks.teardownStoredWorkspace).not.toHaveBeenCalled();
    }
  );

  it('runs full teardown for a legacy archived task without a durable marker', async () => {
    const legacyTask = {
      ...task,
      id: 'task-legacy-archived',
      archivedAt: '2026-07-01T07:00:00.000Z',
      lifecycleTeardownAt: null,
      providerDestroyAt: null,
    };
    const project = { ctx: {}, projectId: 'project-1' };
    const workspace = {
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      path: '/tmp/worktree',
    };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(project);
    mocks.selectLimit.mockResolvedValue([workspace]);

    await expect(teardownTaskResources(legacyTask, 'terminate')).resolves.toEqual({
      success: true,
    });

    expect(mocks.teardownStoredWorkspace).toHaveBeenCalledWith({
      task: legacyTask,
      workspace,
      project,
      mode: 'terminate',
    });
  });

  it('runs the same cold teardown mode again after the task is reactivated', async () => {
    const reactivatedTask = { ...task, id: 'task-reactivated' };
    const project = { ctx: {}, projectId: 'project-1' };
    const workspace = {
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      path: '/tmp/worktree',
    };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(project);
    mocks.selectLimit.mockResolvedValue([workspace]);

    await teardownTaskResources(reactivatedTask, 'archive');
    await teardownTaskResources(reactivatedTask, 'archive');
    expect(mocks.teardownStoredWorkspace).toHaveBeenCalledTimes(1);

    clearTaskResourceTeardown(reactivatedTask.id);
    await teardownTaskResources(reactivatedTask, 'archive');

    expect(mocks.teardownStoredWorkspace).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a cold task project is not mounted', async () => {
    const unmountedTask = { ...task, id: 'task-unmounted' };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(undefined);

    await expect(teardownTaskResources(unmountedTask, 'terminate')).resolves.toEqual({
      success: false,
      error: expect.objectContaining({ message: expect.stringContaining('is not mounted') }),
    });

    expect(mocks.selectLimit).not.toHaveBeenCalled();
    expect(mocks.teardownStoredWorkspace).not.toHaveBeenCalled();
  });

  it('allows deletion of an unprovisioned task without a mounted project', async () => {
    const unprovisionedTask = {
      ...task,
      id: 'task-unprovisioned',
      workspaceId: null,
    };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(undefined);

    await expect(teardownTaskResources(unprovisionedTask, 'terminate')).resolves.toEqual({
      success: true,
    });

    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.teardownStoredWorkspace).not.toHaveBeenCalled();
  });

  it('keeps provider cleanup pending for a cold BYOI task archived before restart', async () => {
    const byoiTask = {
      ...task,
      id: 'task-cold-byoi',
      lifecycleTeardownAt: '2026-07-16T07:00:00.000Z',
      providerDestroyAt: null,
    };
    const project = { ctx: {}, projectId: 'project-1' };
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(project);
    mocks.selectLimit.mockResolvedValue([
      {
        id: 'workspace-1',
        type: 'byoi',
        kind: 'byoi',
        path: '/remote/worktree',
      },
    ]);
    mocks.teardownStoredWorkspace.mockResolvedValue({
      success: false,
      error: { type: 'error', message: 'cold BYOI workspace is unsupported' },
    });

    await expect(teardownTaskResources(byoiTask, 'terminate')).resolves.toEqual({
      success: false,
      error: { type: 'error', message: 'cold BYOI workspace is unsupported' },
    });
    expect(mocks.teardownStoredWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ task: byoiTask, mode: 'terminate-provider' })
    );
  });

  it('queues terminate behind an in-flight archive and runs both modes', async () => {
    const concurrentTask = { ...task, id: 'task-concurrent' };
    const project = { ctx: {}, projectId: 'project-1' };
    const workspace = {
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      path: '/tmp/worktree',
    };
    let finishArchive: ((value: { success: true }) => void) | undefined;
    const archiveResult = new Promise<{ success: true }>((resolve) => {
      finishArchive = resolve;
    });
    mocks.getTask.mockReturnValueOnce({ taskId: concurrentTask.id }).mockReturnValue(undefined);
    mocks.getProject.mockReturnValue(project);
    mocks.selectLimit.mockResolvedValue([workspace]);
    mocks.teardownTask.mockReturnValueOnce(archiveResult);

    const archive = teardownTaskResources(concurrentTask, 'archive');
    const terminate = teardownTaskResources(concurrentTask, 'terminate');

    expect(mocks.teardownTask).toHaveBeenCalledTimes(1);
    finishArchive?.({ success: true });
    await expect(Promise.all([archive, terminate])).resolves.toEqual([
      { success: true },
      { success: true },
    ]);

    expect(mocks.teardownTask).toHaveBeenNthCalledWith(1, concurrentTask.id, 'archive');
    expect(mocks.teardownTask).toHaveBeenCalledTimes(1);
    expect(mocks.teardownStoredWorkspace).toHaveBeenCalledWith({
      task: concurrentTask,
      workspace,
      project,
      mode: 'terminate-provider',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskService } from './task-service';

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  beginTaskProvisioning: vi.fn(),
  deleteTask: vi.fn(),
  emit: vi.fn(),
  ensureWorkspaceSetupForTask: vi.fn(),
  getProject: vi.fn(),
  getTask: vi.fn(),
  persistTaskResourceTeardown: vi.fn(),
  persistTaskProvisioned: vi.fn(),
  registerTask: vi.fn(),
  selectLimit: vi.fn(),
  teardownTask: vi.fn(),
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

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/workspaces/workspace-bootstrap-service', () => ({
  workspaceBootstrapService: {
    ensureWorkspaceSetupForTask: mocks.ensureWorkspaceSetupForTask,
  },
}));

vi.mock('./task-session-manager', () => ({
  taskSessionManager: {
    getTask: mocks.getTask,
    registerTask: mocks.registerTask,
    teardownTask: mocks.teardownTask,
  },
}));

vi.mock('./operations/persistTaskProvisioned', () => ({
  persistTaskProvisioned: mocks.persistTaskProvisioned,
}));

vi.mock('./operations/beginTaskProvisioning', () => ({
  beginTaskProvisioning: mocks.beginTaskProvisioning,
}));

vi.mock('./operations/archiveTask', () => ({
  archiveTask: mocks.archiveTask,
}));

vi.mock('./operations/deleteTask', () => ({
  deleteTask: mocks.deleteTask,
}));

vi.mock('./operations/persistTaskResourceTeardown', () => ({
  persistTaskResourceTeardown: mocks.persistTaskResourceTeardown,
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: mocks.emit },
}));

const taskRow = {
  id: 'task-1',
  projectId: 'project-1',
  name: 'Task 1',
  status: 'working',
  sourceBranch: null,
  taskBranch: null,
  linkedIssue: null,
  archivedAt: null,
  lifecycleTeardownAt: '2026-07-16T07:00:00.000Z',
  createdAt: '2026-07-16T06:00:00.000Z',
  updatedAt: '2026-07-16T06:00:00.000Z',
  lastInteractedAt: null,
  statusChangedAt: '2026-07-16T06:00:00.000Z',
  isPinned: 0,
  workspaceProvider: null,
  workspaceId: 'workspace-1',
  workspaceProviderData: null,
  workspaceIntent: null,
  type: 'task',
  automationRunId: null,
};

describe('TaskService provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectLimit.mockResolvedValue([taskRow]);
    mocks.getTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue({ ctx: {} });
    mocks.ensureWorkspaceSetupForTask.mockResolvedValue({
      success: true,
      data: {
        taskProvider: {},
        workspaceId: 'workspace-2',
        path: '/tmp/workspace-2',
      },
    });
    mocks.beginTaskProvisioning.mockResolvedValue(undefined);
    mocks.archiveTask.mockResolvedValue(undefined);
    mocks.deleteTask.mockResolvedValue(undefined);
    mocks.persistTaskProvisioned.mockResolvedValue(undefined);
    mocks.persistTaskResourceTeardown.mockResolvedValue(undefined);
    mocks.registerTask.mockResolvedValue(undefined);
    mocks.teardownTask.mockResolvedValue({ success: true });
  });

  it('clears lifecycle completion before workspace acquire/setup starts', async () => {
    await expect(taskService.provisionWorkspace('task-1')).resolves.toEqual({
      success: true,
      data: {
        workspaceId: 'workspace-2',
        path: '/tmp/workspace-2',
        sshConnectionId: undefined,
      },
    });

    expect(mocks.beginTaskProvisioning).toHaveBeenCalledWith('task-1');
    expect(mocks.beginTaskProvisioning.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureWorkspaceSetupForTask.mock.invocationCallOrder[0]
    );
  });

  it('keeps lifecycle completion cleared when provisioning fails', async () => {
    mocks.ensureWorkspaceSetupForTask.mockResolvedValue({
      success: false,
      error: { type: 'setup-failed', message: 'setup failed' },
    });

    await expect(taskService.provisionWorkspace('task-1')).resolves.toEqual({
      success: false,
      error: { type: 'setup-failed', message: 'setup failed' },
    });

    expect(mocks.beginTaskProvisioning).toHaveBeenCalledWith('task-1');
    expect(mocks.persistTaskProvisioned).not.toHaveBeenCalled();
    expect(mocks.registerTask).not.toHaveBeenCalled();
  });

  it('waits for provisioning to finish before archiving the same task', async () => {
    let finishSetup!: () => void;
    mocks.ensureWorkspaceSetupForTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSetup = () =>
            resolve({
              success: true,
              data: {
                taskProvider: {},
                workspaceId: 'workspace-2',
                path: '/tmp/workspace-2',
              },
            });
        })
    );

    const provisioning = taskService.provisionWorkspace('task-1');
    await vi.waitFor(() => expect(mocks.ensureWorkspaceSetupForTask).toHaveBeenCalled());

    const archiving = taskService.archiveTask('project-1', 'task-1');
    await Promise.resolve();
    expect(mocks.archiveTask).not.toHaveBeenCalled();

    finishSetup();
    await expect(provisioning).resolves.toMatchObject({ success: true });
    await archiving;

    expect(mocks.registerTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.archiveTask.mock.invocationCallOrder[0]
    );
  });

  it('waits for failed provisioning before deleting the same task', async () => {
    let failSetup!: () => void;
    mocks.ensureWorkspaceSetupForTask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          failSetup = () =>
            resolve({
              success: false,
              error: { type: 'setup-failed', message: 'setup failed' },
            });
        })
    );

    const provisioning = taskService.provisionWorkspace('task-1');
    await vi.waitFor(() => expect(mocks.ensureWorkspaceSetupForTask).toHaveBeenCalled());

    const deleting = taskService.deleteTask('project-1', 'task-1');
    await Promise.resolve();
    expect(mocks.deleteTask).not.toHaveBeenCalled();

    failSetup();
    await expect(provisioning).resolves.toMatchObject({ success: false });
    await deleting;
    expect(mocks.deleteTask).toHaveBeenCalledWith('project-1', 'task-1', undefined);
  });

  it('allows provisioning retry after a setup failure', async () => {
    mocks.ensureWorkspaceSetupForTask
      .mockResolvedValueOnce({
        success: false,
        error: { type: 'setup-failed', message: 'setup failed' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          taskProvider: {},
          workspaceId: 'workspace-3',
          path: '/tmp/workspace-3',
        },
      });

    await expect(taskService.provisionWorkspace('task-1')).resolves.toMatchObject({
      success: false,
    });
    await expect(taskService.provisionWorkspace('task-1')).resolves.toMatchObject({
      success: true,
    });
    expect(mocks.ensureWorkspaceSetupForTask).toHaveBeenCalledTimes(2);
  });

  it('does not reprovision a task that won an archive race', async () => {
    let finishArchive!: () => void;
    mocks.archiveTask.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishArchive = resolve;
        })
    );

    const archiving = taskService.archiveTask('project-1', 'task-1');
    await vi.waitFor(() => expect(mocks.archiveTask).toHaveBeenCalled());

    const provisioning = taskService.provisionWorkspace('task-1');
    mocks.selectLimit.mockResolvedValue([{ ...taskRow, archivedAt: '2026-07-16T08:00:00.000Z' }]);
    finishArchive();
    await archiving;

    await expect(provisioning).rejects.toThrow('Cannot provision archived task: task-1');
    expect(mocks.beginTaskProvisioning).not.toHaveBeenCalled();
    expect(mocks.ensureWorkspaceSetupForTask).not.toHaveBeenCalled();
  });

  it('persists successful direct termination when the live task row is retained', async () => {
    mocks.getTask.mockReturnValue({ taskId: 'task-1' });

    await expect(taskService.teardown('task-1', 'terminate')).resolves.toEqual({ success: true });

    expect(mocks.persistTaskResourceTeardown).toHaveBeenCalledWith('task-1');
    expect(mocks.teardownTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.persistTaskResourceTeardown.mock.invocationCallOrder[0]
    );
  });

  it('does not persist a no-op termination for a cold task', async () => {
    mocks.getTask.mockReturnValue(undefined);

    await taskService.teardown('task-1', 'terminate');

    expect(mocks.persistTaskResourceTeardown).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskService } from './task-service';

const mocks = vi.hoisted(() => ({
  beginTaskProvisioning: vi.fn(),
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

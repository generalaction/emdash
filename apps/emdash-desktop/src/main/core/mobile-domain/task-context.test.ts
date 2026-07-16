import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReadyTaskContext } from './task-context';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  openProject: vi.fn(),
  provisionWorkspace: vi.fn(),
  getBootstrapStatus: vi.fn(),
  getWorkspaceId: vi.fn(),
  getPersistData: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

vi.mock('@main/core/projects/operations/openProject', () => ({
  openProject: mocks.openProject,
}));

vi.mock('@main/core/tasks/task-service', () => ({
  taskService: { provisionWorkspace: mocks.provisionWorkspace },
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: {
    getBootstrapStatus: mocks.getBootstrapStatus,
    getWorkspaceId: mocks.getWorkspaceId,
    getPersistData: mocks.getPersistData,
  },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: { get: mocks.getWorkspace },
}));

const task = {
  id: 'task-1',
  projectId: 'project-1',
  workspaceId: 'stored-workspace',
  name: 'Mobile task',
};

function mockTaskQuery(value: typeof task | undefined = task) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(value ? [value] : []),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
}

describe('mobile task context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskQuery();
    mocks.openProject.mockResolvedValue({
      success: true,
      data: { repositoryWorkspaceId: null },
    });
    mocks.provisionWorkspace.mockResolvedValue({
      success: true,
      data: { path: '/workspace', workspaceId: 'live-workspace' },
    });
    mocks.getWorkspaceId.mockReturnValue('live-workspace');
    mocks.getPersistData.mockReturnValue({ workspaceId: 'live-workspace' });
    mocks.getWorkspace.mockReturnValue({ path: '/workspace' });
  });

  it('uses an already-ready task without reopening or provisioning it', async () => {
    mocks.getBootstrapStatus.mockReturnValue({ status: 'ready' });

    const context = await getReadyTaskContext(task.id);

    expect(context.task).toEqual(task);
    expect(context.workspaceId).toBe('live-workspace');
    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(mocks.provisionWorkspace).not.toHaveBeenCalled();
  });

  it('opens the project and provisions a dormant task before resolving its workspace', async () => {
    mocks.getBootstrapStatus
      .mockReturnValueOnce({ status: 'not-started' })
      .mockReturnValue({ status: 'ready' });

    const context = await getReadyTaskContext(task.id);

    expect(mocks.openProject).toHaveBeenCalledWith(task.projectId);
    expect(mocks.provisionWorkspace).toHaveBeenCalledWith(task.id);
    expect(mocks.openProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.provisionWorkspace.mock.invocationCallOrder[0]
    );
    expect(context.workspaceId).toBe('live-workspace');
    expect(context.workspace).toEqual({ path: '/workspace' });
  });

  it('deduplicates concurrent readiness requests for the same dormant task', async () => {
    let ready = false;
    let finishProvisioning: (() => void) | undefined;
    const provisionGate = new Promise<void>((resolve) => {
      finishProvisioning = resolve;
    });
    mocks.getBootstrapStatus.mockImplementation(() => ({
      status: ready ? 'ready' : 'not-started',
    }));
    mocks.provisionWorkspace.mockImplementation(async () => {
      await provisionGate;
      ready = true;
      return {
        success: true,
        data: { path: '/workspace', workspaceId: 'live-workspace' },
      };
    });

    const first = getReadyTaskContext(task.id);
    const second = getReadyTaskContext(task.id);
    await vi.waitFor(() => expect(mocks.provisionWorkspace).toHaveBeenCalledTimes(1));
    finishProvisioning?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.openProject).toHaveBeenCalledTimes(1);
    expect(mocks.provisionWorkspace).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing bootstrap error without retrying setup', async () => {
    mocks.getBootstrapStatus.mockReturnValue({ status: 'error', message: 'Setup failed' });

    await expect(getReadyTaskContext(task.id)).rejects.toThrow('Setup failed');
    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(mocks.provisionWorkspace).not.toHaveBeenCalled();
  });
});

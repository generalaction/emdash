import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import { deleteProject } from './deleteProject';

const mocks = vi.hoisted(() => ({
  automationEmit: vi.fn(),
  captureTelemetry: vi.fn(),
  closeProject: vi.fn(),
  deleteProjectData: vi.fn(),
  deleteProjectRow: vi.fn(),
  deleteWhere: vi.fn(),
  delViewState: vi.fn(),
  detachProject: vi.fn(),
  getProject: vi.fn(),
  getTasks: vi.fn(),
  projectEmit: vi.fn(),
  teardownTask: vi.fn(),
}));

vi.mock('@main/core/automations/automation-events', () => ({
  automationEvents: { _emit: mocks.automationEmit },
}));

vi.mock('@main/core/automations/service', () => ({
  detachProject: mocks.detachProject,
}));

vi.mock('@main/core/projects/project-events', () => ({
  projectEvents: { _emit: mocks.projectEmit },
}));

vi.mock('@main/db/client', () => ({
  db: {
    delete: mocks.deleteProjectRow,
  },
}));

vi.mock('@main/core/tasks/operations/getTasks', () => ({
  getTasks: mocks.getTasks,
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProject,
    closeProject: mocks.closeProject,
  },
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: {
    teardownTask: mocks.teardownTask,
  },
}));

vi.mock('@main/core/pull-requests/pr-sync-engine', () => ({
  prSyncEngine: {
    deleteProjectData: mocks.deleteProjectData,
  },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: {
    del: mocks.delViewState,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.captureTelemetry,
  },
}));

describe('deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.deleteProjectRow.mockReturnValue({ where: mocks.deleteWhere });
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.getTasks.mockResolvedValue([{ id: 'task-1' }]);
    mocks.getProject.mockReturnValue({ projectId: 'project-1' });
    mocks.closeProject.mockResolvedValue(ok());
    mocks.teardownTask.mockResolvedValue(ok());
    mocks.deleteProjectData.mockResolvedValue(undefined);
    mocks.detachProject.mockResolvedValue(0);
    mocks.delViewState.mockResolvedValue(undefined);
  });

  it('closes a mounted project before deleting its database row', async () => {
    await deleteProject('project-1');

    expect(mocks.closeProject).toHaveBeenCalledWith('project-1');
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
    const closeOrder = mocks.closeProject.mock.invocationCallOrder[0];
    const deleteOrder = mocks.deleteWhere.mock.invocationCallOrder[0];
    expect(closeOrder).toBeDefined();
    expect(deleteOrder).toBeDefined();
    expect(closeOrder!).toBeLessThan(deleteOrder!);
  });

  it('deletes an unmounted project without closing a provider', async () => {
    mocks.getProject.mockReturnValue(undefined);

    await deleteProject('project-1');

    expect(mocks.closeProject).not.toHaveBeenCalled();
    expect(mocks.getTasks).not.toHaveBeenCalled();
    expect(mocks.teardownTask).not.toHaveBeenCalled();
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('cleans PR sync data and automation project links before deleting the project row', async () => {
    await deleteProject('project-1');

    expect(mocks.deleteProjectData).toHaveBeenCalledWith('project-1');
    expect(mocks.detachProject).toHaveBeenCalledWith('project-1');
    expect(mocks.deleteProjectRow).toHaveBeenCalledTimes(1);
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);

    expect(mocks.deleteProjectData.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteProjectRow.mock.invocationCallOrder[0]
    );
    expect(mocks.detachProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteProjectRow.mock.invocationCallOrder[0]
    );
  });
});

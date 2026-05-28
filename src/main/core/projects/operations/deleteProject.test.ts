import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import { deleteProject } from './deleteProject';

const mocks = vi.hoisted(() => ({
  deleteProjectRow: vi.fn(),
  deleteWhere: vi.fn(),
  getTasks: vi.fn(),
  getProject: vi.fn(),
  closeProject: vi.fn(),
  teardownTask: vi.fn(),
  deleteProjectData: vi.fn(),
  delViewState: vi.fn(),
  captureTelemetry: vi.fn(),
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
    mocks.delViewState.mockResolvedValue(undefined);
  });

  it('closes a mounted project before deleting its database row', async () => {
    await deleteProject('project-1');

    expect(mocks.closeProject).toHaveBeenCalledWith('project-1');
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mocks.closeProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteWhere.mock.invocationCallOrder[0]!
    );
  });
});

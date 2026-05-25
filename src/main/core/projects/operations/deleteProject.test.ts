import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProject } from './deleteProject';

const mocks = vi.hoisted(() => ({
  automationEmitMock: vi.fn(),
  closeProjectMock: vi.fn(),
  dbDeleteMock: vi.fn(),
  dbWhereMock: vi.fn(),
  deleteProjectDataMock: vi.fn(),
  detachProjectMock: vi.fn(),
  getProjectMock: vi.fn(),
  getTasksMock: vi.fn(),
  projectEmitMock: vi.fn(),
  teardownTaskMock: vi.fn(),
  telemetryCaptureMock: vi.fn(),
  viewStateDelMock: vi.fn(),
}));

vi.mock('@main/core/automations/automation-events', () => ({
  automationEvents: { _emit: mocks.automationEmitMock },
}));

vi.mock('@main/core/automations/repo', () => ({
  detachProject: mocks.detachProjectMock,
}));

vi.mock('@main/core/projects/project-events', () => ({
  projectEvents: { _emit: mocks.projectEmitMock },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    closeProject: mocks.closeProjectMock,
    getProject: mocks.getProjectMock,
  },
}));

vi.mock('@main/core/pull-requests/pr-sync-engine', () => ({
  prSyncEngine: { deleteProjectData: mocks.deleteProjectDataMock },
}));

vi.mock('@main/core/tasks/operations/getTasks', () => ({
  getTasks: mocks.getTasksMock,
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: { teardownTask: mocks.teardownTaskMock },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: { del: mocks.viewStateDelMock },
}));

vi.mock('@main/db/client', () => ({
  db: { delete: mocks.dbDeleteMock },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.telemetryCaptureMock },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectMock.mockReturnValue(undefined);
  mocks.getTasksMock.mockResolvedValue([]);
  mocks.deleteProjectDataMock.mockResolvedValue(undefined);
  mocks.detachProjectMock.mockResolvedValue(0);
  mocks.dbDeleteMock.mockReturnValue({ where: mocks.dbWhereMock });
  mocks.dbWhereMock.mockResolvedValue(undefined);
  mocks.closeProjectMock.mockResolvedValue(undefined);
  mocks.viewStateDelMock.mockResolvedValue(undefined);
});

describe('deleteProject', () => {
  it('cleans PR sync data and automation project links before deleting the project row', async () => {
    await deleteProject('project-1');

    expect(mocks.deleteProjectDataMock).toHaveBeenCalledWith('project-1');
    expect(mocks.detachProjectMock).toHaveBeenCalledWith('project-1');
    expect(mocks.dbDeleteMock).toHaveBeenCalledTimes(1);
    expect(mocks.dbWhereMock).toHaveBeenCalledTimes(1);

    expect(mocks.deleteProjectDataMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dbDeleteMock.mock.invocationCallOrder[0]
    );
    expect(mocks.detachProjectMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dbDeleteMock.mock.invocationCallOrder[0]
    );
  });
});

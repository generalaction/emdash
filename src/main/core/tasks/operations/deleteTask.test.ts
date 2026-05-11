import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  getProjectMock: vi.fn(),
  teardownTaskMock: vi.fn(),
  removeTaskWorktreeMock: vi.fn(),
  deleteBranchMock: vi.fn(),
  selectMock: vi.fn(),
  fromSelectMock: vi.fn(),
  whereSelectMock: vi.fn(),
  limitSelectMock: vi.fn(),
  selectSiblingsMock: vi.fn(),
  fromSiblingsMock: vi.fn(),
  whereSiblingsMock: vi.fn(),
  limitSiblingsMock: vi.fn(),
  deleteMock: vi.fn(),
  whereDeleteMock: vi.fn(),
  taskEventsEmitMock: vi.fn(),
  telemetryCaptureMock: vi.fn(),
  viewStateDelMock: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProjectMock },
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: { teardownTask: mocks.teardownTaskMock },
}));

vi.mock('@main/core/tasks/task-events', () => ({
  taskEvents: { _emit: mocks.taskEventsEmitMock },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.telemetryCaptureMock },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: { del: mocks.viewStateDelMock },
}));

vi.mock('@main/db/schema', () => ({ tasks: {} }));

vi.mock('@main/db/client', () => ({
  db: {
    // First select() in deleteTask is the task lookup; subsequent select with a column projection
    // is the siblings query.
    select: (...args: unknown[]) =>
      args.length === 0 ? mocks.selectMock() : mocks.selectSiblingsMock(),
    delete: () => mocks.deleteMock(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();

  mocks.selectMock.mockReturnValue({ from: mocks.fromSelectMock });
  mocks.fromSelectMock.mockReturnValue({ where: mocks.whereSelectMock });
  mocks.whereSelectMock.mockReturnValue({ limit: mocks.limitSelectMock });

  mocks.selectSiblingsMock.mockReturnValue({ from: mocks.fromSiblingsMock });
  mocks.fromSiblingsMock.mockReturnValue({ where: mocks.whereSiblingsMock });
  mocks.whereSiblingsMock.mockReturnValue({ limit: mocks.limitSiblingsMock });
  mocks.limitSiblingsMock.mockResolvedValue([]);

  mocks.deleteMock.mockReturnValue({ where: mocks.whereDeleteMock });
  mocks.whereDeleteMock.mockResolvedValue(undefined);

  mocks.teardownTaskMock.mockResolvedValue({ success: true, value: undefined });
});

describe('deleteTask — non-git task', () => {
  it('does not call removeTaskWorktree or deleteBranch when taskBranch is null', async () => {
    mocks.limitSelectMock.mockResolvedValueOnce([
      {
        id: 'task-id',
        projectId: 'project-id',
        taskBranch: null,
        sourceBranch: null,
      },
    ]);

    mocks.getProjectMock.mockReturnValue({
      removeTaskWorktree: mocks.removeTaskWorktreeMock,
      repository: { deleteBranch: mocks.deleteBranchMock },
    });

    await deleteTask('project-id', 'task-id');

    expect(mocks.teardownTaskMock).toHaveBeenCalledWith('task-id', 'terminate');
    expect(mocks.removeTaskWorktreeMock).not.toHaveBeenCalled();
    expect(mocks.deleteBranchMock).not.toHaveBeenCalled();
    expect(mocks.taskEventsEmitMock).toHaveBeenCalledWith('task:deleted', 'task-id', 'project-id');
  });
});

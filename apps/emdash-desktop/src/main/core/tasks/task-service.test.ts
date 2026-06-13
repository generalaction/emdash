import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@main/lib/events';
import { taskArchivedChannel } from '@shared/core/tasks/taskEvents';
import { archiveTask as archiveTaskOp } from './operations/archiveTask';

// task-service pulls in the full main-process graph at import time; mock the
// heavy singletons / db so the module loads in a plain node test, and stub
// every task operation so we can drive the service in isolation.
vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
}));
vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@main/db/client', () => ({ db: {} }));
vi.mock('@main/db/schema', () => ({ tasks: {}, workspaces: {} }));
vi.mock('@main/core/projects/project-manager', () => ({ projectManager: {} }));
vi.mock('@main/core/workspaces/workspace-bootstrap-service', () => ({
  workspaceBootstrapService: {},
}));
vi.mock('@main/core/workspaces/workspace-registry', () => ({ workspaceRegistry: {} }));
vi.mock('./task-session-manager', () => ({ taskSessionManager: {} }));
vi.mock('./utils/utils', () => ({ mapTaskRowToTask: vi.fn() }));
vi.mock('./operations/archiveTask', () => ({ archiveTask: vi.fn(async () => undefined) }));
vi.mock('./operations/createTask', () => ({ createTask: vi.fn() }));
vi.mock('./operations/deleteTask', () => ({ deleteTask: vi.fn() }));
vi.mock('./operations/getDeletePreflight', () => ({ getDeletePreflight: vi.fn() }));
vi.mock('./operations/getTasks', () => ({ getTasks: vi.fn() }));
vi.mock('./operations/renameTask', () => ({ renameTask: vi.fn() }));
vi.mock('./operations/restoreTask', () => ({ restoreTask: vi.fn() }));
vi.mock('./operations/setTaskPinned', () => ({ setTaskPinned: vi.fn() }));
vi.mock('./operations/updateLinkedIssue', () => ({ updateLinkedIssue: vi.fn() }));
vi.mock('./operations/updateTaskStatus', () => ({ updateTaskStatus: vi.fn() }));

const { TaskService } = await import('./task-service');

const mockEmit = vi.mocked(events.emit);
const mockArchiveOp = vi.mocked(archiveTaskOp);

describe('TaskService.archiveTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('archives via the operation and notifies open windows', async () => {
    const service = new TaskService();
    await service.archiveTask('project-1', 'task-1');

    expect(mockArchiveOp).toHaveBeenCalledWith('project-1', 'task-1');
    expect(mockEmit).toHaveBeenCalledWith(taskArchivedChannel, {
      taskId: 'task-1',
      projectId: 'project-1',
    });
  });

  it('emits the archived event only after the archive operation completes', async () => {
    const order: string[] = [];
    mockArchiveOp.mockImplementationOnce(async () => {
      order.push('archive-op');
    });
    mockEmit.mockImplementationOnce(() => {
      order.push('emit');
      return undefined as never;
    });

    const service = new TaskService();
    await service.archiveTask('project-1', 'task-1');

    expect(order).toEqual(['archive-op', 'emit']);
  });

  it('does not emit the archived event when the archive operation fails', async () => {
    mockArchiveOp.mockRejectedValueOnce(new Error('db constraint violation'));

    const service = new TaskService();
    await expect(service.archiveTask('project-1', 'task-1')).rejects.toThrow(
      'db constraint violation'
    );

    // An emitted event here would make every open window hide a task that is
    // still alive in the database.
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskService } from './task-service';

const operationMocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  buildTaskFromWorkspace: vi.fn(),
  createWorkspaceRegistry: vi.fn(),
  deleteTask: vi.fn(),
  tryAcquireWorkspaceRuntime: vi.fn(),
}));

vi.mock('../../node/operations/archiveTask', () => ({
  archiveTask: operationMocks.archiveTask,
}));

vi.mock('../../node/operations/deleteTask', () => ({
  deleteTask: operationMocks.deleteTask,
}));

vi.mock('@core/features/tasks/api/node/task-provider-assembly', () => ({
  buildTaskFromWorkspace: operationMocks.buildTaskFromWorkspace,
}));

vi.mock('@core/features/workspaces/api/node/registry', () => ({
  createWorkspaceRegistry: operationMocks.createWorkspaceRegistry,
}));

vi.mock('@core/features/workspaces/api/node/runtime-access', () => ({
  tryAcquireWorkspaceRuntime: operationMocks.tryAcquireWorkspaceRuntime,
}));

function makeService() {
  const projects = {
    requireAttached: vi.fn(() =>
      err({
        type: 'attachment-unavailable' as const,
        host: { type: 'remote' as const, id: 'ssh-1' },
        phase: 'waiting' as const,
      })
    ),
  };
  const sessions = {
    getTask: vi.fn(() => ({ id: 'retained-session' })),
  };
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ projectId: 'project-1' }],
        }),
      }),
    })),
  };
  const service = new TaskService({
    db,
    projects,
    sessions,
    deletion: {},
  } as never);
  return { db, projects, service, sessions };
}

describe('TaskService offline desktop mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operationMocks.deleteTask.mockResolvedValue(ok<void>());
    operationMocks.archiveTask.mockResolvedValue(undefined);
  });

  it('deletes through the desktop operation when a retained session Host is unavailable', async () => {
    const { projects, service } = makeService();

    await service.deleteTask('project-1', 'task-1', {
      deleteWorktree: false,
      deleteConversations: false,
    });

    expect(operationMocks.deleteTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskId: 'task-1',
        deleteWorktree: false,
        deleteConversations: false,
      })
    );
    expect(projects.requireAttached).not.toHaveBeenCalled();
  });

  it('archives through the desktop operation when retained-session teardown is unavailable', async () => {
    const { db, projects, service, sessions } = makeService();
    const telemetry = { capture: vi.fn() };

    await service.archiveTask('project-1', 'task-1', telemetry);

    expect(operationMocks.archiveTask).toHaveBeenCalledWith(
      db,
      sessions,
      'project-1',
      'task-1',
      telemetry
    );
    expect(projects.requireAttached).not.toHaveBeenCalled();
  });
});

describe('TaskService workspace activation', () => {
  it('activates a workspace whose persisted path uses Windows drive syntax', async () => {
    const workspacePath = 'C:\\Users\\taehyun\\emdash\\task-1';
    const activateWorkspace = vi.fn(async () => ok({}));
    operationMocks.createWorkspaceRegistry.mockReturnValue({
      getLive: () => ({
        id: 'workspace-1',
        path: workspacePath,
        kind: 'worktree',
        config: null,
        observedStatus: 'present',
        lastCreateOutcome: { status: 'succeeded' },
      }),
    });
    operationMocks.tryAcquireWorkspaceRuntime.mockResolvedValue(
      ok({
        identity: {
          workspaceId: 'workspace-1',
          host: LOCAL_HOST_REF,
          path: workspacePath,
          projectId: 'project-1',
        },
        client: { workspaceRegistry: { activateWorkspace }, tuiAgents: {} },
        files: {},
      })
    );
    operationMocks.buildTaskFromWorkspace.mockResolvedValue(
      ok({ taskProvider: {}, conversationProvider: {} })
    );
    const service = new TaskService({
      db: {},
      creations: { pending: () => undefined },
      lifecycleParticipants: [],
      runtimes: {},
      workspaceIdentity: {},
      sessionLaunchContexts: {},
      createConversationProvider: vi.fn(),
    } as never);
    const taskRow = {
      id: 'task-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      name: 'Windows task',
      status: 'todo',
      linkedIssue: null,
      archivedAt: null,
      lastInteractedAt: null,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
      statusChangedAt: '2026-08-29T00:00:00.000Z',
      isPinned: 0,
      type: 'task',
      automationRunId: null,
    };

    const result = await (
      service as unknown as {
        _activateWorkspace(
          row: typeof taskRow,
          project: Record<string, never>
        ): Promise<
          | { success: true; data: { runtimeWorkspace: { path: { root: { kind: string } } } } }
          | { success: false; error: unknown }
        >;
      }
    )._activateWorkspace(taskRow, {});

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.runtimeWorkspace.path.root.kind).toBe('drive');
    expect(activateWorkspace).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
  });
});

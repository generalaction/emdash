import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import { createManualClock, deferred } from '@emdash/shared/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskService } from './task-service';
import { TaskSessionManager } from './task-session-manager';

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

function makeLifecycleService() {
  const clock = createManualClock();
  const events: string[] = [];
  const identity = {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    host: LOCAL_HOST_REF,
    path: '/repo/task',
  };
  const row = {
    id: 'task-1',
    projectId: 'project-1',
    workspaceId: identity.workspaceId,
    name: 'Task',
    status: 'todo',
    linkedIssue: null,
    archivedAt: null,
    lastInteractedAt: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    statusChangedAt: '2026-09-16T00:00:00.000Z',
    isPinned: 0,
    type: 'task',
    automationRunId: null,
  };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const hostActivate = vi.fn(async () => {
    events.push('host:activate');
    return ok({});
  });
  const hostDeactivate = vi.fn(async () => {
    events.push('host:deactivate');
    return ok();
  });
  const activateParticipants = vi.fn(async () => {
    events.push('participants:activate');
  });
  const deactivateParticipants = vi.fn(async () => {
    events.push('participants:deactivate');
  });
  const client = {
    workspaceRegistry: { activateWorkspace: hostActivate, deactivateWorkspace: hostDeactivate },
    tuiAgents: {},
  };
  const runtimes = { client: async () => ok(client) };
  const workspaceIdentity = { resolve: async () => identity };
  const sessions = new TaskSessionManager({
    clock,
    db,
    runtimes,
    workspaceIdentity,
    deactivateWorkspaceParticipants: deactivateParticipants,
  } as never);
  const taskProvider = {
    taskId: row.id,
    conversations: { destroyAll: vi.fn(async () => {}), detachAll: vi.fn(async () => {}) },
  };
  operationMocks.createWorkspaceRegistry.mockReturnValue({
    getLive: () => ({
      id: identity.workspaceId,
      path: identity.path,
      kind: 'worktree',
      config: null,
      observedStatus: 'present',
    }),
  });
  operationMocks.tryAcquireWorkspaceRuntime.mockResolvedValue(ok({ identity, client, files: {} }));
  operationMocks.buildTaskFromWorkspace.mockResolvedValue(ok({ taskProvider }));
  const service = new TaskService({
    db,
    sessions,
    runtimes,
    workspaceIdentity,
    projects: { requireAttached: () => ok({ projectId: row.projectId }) },
    creations: { pending: () => undefined },
    lifecycleParticipants: [{ id: 'test', activate: activateParticipants }],
    sessionLaunchContexts: {},
    createConversationProvider: vi.fn(),
  } as never);
  return {
    clock,
    events,
    sessions,
    service,
    hostActivate,
    hostDeactivate,
    activateParticipants,
    deactivateParticipants,
    taskProvider,
  };
}

describe('TaskService cleanup and activation ordering', () => {
  it.each([
    { mounted: false, stalledAt: 'participants' },
    { mounted: false, stalledAt: 'host' },
    { mounted: true, stalledAt: 'participants' },
    { mounted: true, stalledAt: 'host' },
  ] as const)(
    'waits for actual $stalledAt cleanup after archive times out (mounted: $mounted)',
    async ({ mounted, stalledAt }) => {
      const fixture = makeLifecycleService();
      if (mounted) expect((await fixture.service.provisionWorkspace('task-1')).success).toBe(true);
      fixture.events.length = 0;
      fixture.hostActivate.mockClear();
      fixture.activateParticipants.mockClear();
      const entered = deferred();
      const cleanup = deferred();
      if (stalledAt === 'participants') {
        fixture.deactivateParticipants.mockImplementationOnce(async () => {
          entered.resolve();
          await cleanup.promise;
          fixture.events.push('participants:deactivate');
        });
      } else {
        fixture.hostDeactivate.mockImplementationOnce(async () => {
          entered.resolve();
          await cleanup.promise;
          fixture.events.push('host:deactivate');
          return ok();
        });
      }
      const teardown = fixture.sessions.teardownTask('task-1', 'archive', 'workspace-1');
      await entered.promise;
      await fixture.clock.advanceBy(600_000);
      expect(await teardown).toMatchObject({ success: false, error: { type: 'timeout' } });

      // Archive has returned, but its cleanup is still running.
      const activation = fixture.service.provisionWorkspace('task-1');
      try {
        // Drain DB/runtime reads without advancing the injected timeout clock.
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fixture.hostActivate).not.toHaveBeenCalled();
        expect(fixture.activateParticipants).not.toHaveBeenCalled();
      } finally {
        cleanup.resolve();
      }
      expect((await activation).success).toBe(true);
      expect(fixture.events).toEqual([
        'participants:deactivate',
        'host:deactivate',
        'host:activate',
        'participants:activate',
      ]);
    }
  );

  it('allows a waiting activation to be cancelled without interrupting cleanup', async () => {
    const fixture = makeLifecycleService();
    const entered = deferred();
    const cleanup = deferred();
    fixture.deactivateParticipants.mockImplementationOnce(async () => {
      entered.resolve();
      await cleanup.promise;
    });
    const teardown = fixture.sessions.teardownTask('task-1', 'archive', 'workspace-1');
    await entered.promise;
    const controller = new AbortController();
    const activation = fixture.service.provisionWorkspace('task-1', controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    try {
      expect(await activation).toMatchObject({ success: false, error: { type: 'cancelled' } });
      expect(fixture.hostActivate).not.toHaveBeenCalled();
    } finally {
      cleanup.resolve();
    }
    expect((await teardown).success).toBe(true);
    expect((await fixture.service.provisionWorkspace('task-1')).success).toBe(true);
    expect(fixture.hostActivate).toHaveBeenCalledOnce();
  });

  it('does not enqueue an activation whose signal is already aborted', async () => {
    const fixture = makeLifecycleService();
    const controller = new AbortController();
    controller.abort();
    expect(await fixture.service.provisionWorkspace('task-1', controller.signal)).toMatchObject({
      success: false,
      error: { type: 'cancelled' },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fixture.hostActivate).not.toHaveBeenCalled();
    expect(fixture.activateParticipants).not.toHaveBeenCalled();
  });

  it('releases a failed archived session before allowing a fresh activation', async () => {
    const fixture = makeLifecycleService();
    await fixture.service.provisionWorkspace('task-1');
    fixture.hostActivate.mockClear();
    fixture.taskProvider.conversations.destroyAll.mockRejectedValueOnce(
      new Error('cleanup failed')
    );
    expect(await fixture.sessions.teardownTask('task-1', 'archive')).toMatchObject({
      success: false,
      error: { type: 'error' },
    });
    expect(fixture.sessions.getTask('task-1')).toBeUndefined();
    expect((await fixture.service.provisionWorkspace('task-1')).success).toBe(true);
    expect(fixture.hostActivate).toHaveBeenCalledOnce();
  });

  it('does not run cleanup whose timeout expired while activation was still in progress', async () => {
    const fixture = makeLifecycleService();
    const entered = deferred();
    const activating = deferred();
    fixture.activateParticipants.mockImplementationOnce(async () => {
      entered.resolve();
      await activating.promise;
    });
    const activation = fixture.service.provisionWorkspace('task-1');
    await entered.promise;
    const teardown = fixture.sessions.teardownTask('task-1', 'archive', 'workspace-1');
    await fixture.clock.advanceBy(600_000);
    try {
      expect(await teardown).toMatchObject({ success: false, error: { type: 'timeout' } });
    } finally {
      activating.resolve();
    }
    expect((await activation).success).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fixture.deactivateParticipants).not.toHaveBeenCalled();
    expect(fixture.hostDeactivate).not.toHaveBeenCalled();
    expect(fixture.sessions.getTask('task-1')).toBeDefined();
  });

  it('does not block unrelated workspaces behind slow cleanup', async () => {
    const fixture = makeLifecycleService();
    const entered = deferred();
    const cleanup = deferred();
    fixture.deactivateParticipants.mockImplementationOnce(async () => {
      entered.resolve();
      await cleanup.promise;
    });
    const teardown = fixture.sessions.teardownTask('task-1', 'archive', 'workspace-1');
    await entered.promise;
    try {
      expect(
        await fixture.sessions.withWorkspaceLifecycle('workspace-2', async () => 'ready')
      ).toBe('ready');
    } finally {
      cleanup.resolve();
    }
    expect((await teardown).success).toBe(true);
  });
});

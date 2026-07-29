import { hostRef } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { ManualClock } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { operationKinds, type OperationKind } from '@core/primitives/operations/api';
import {
  lifecycleOperations,
  operationClaims,
  projects,
  sshConnections,
  tasks,
  workspaces,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import {
  createOperationsEngine,
  type OperationDefinition,
  type OperationsEngineHandle,
} from '@core/services/operations/node';
import { createDeleteTaskOperationDefinition, enqueueDeleteTask } from './delete-task-definition';

const mocks = vi.hoisted(() => ({
  deleteBySubject: vi.fn(async () => ({ success: true, data: { deleted: 1 } })),
  capture: vi.fn(),
  unregisterFileSearchRoot: vi.fn(),
}));
const dependencies = {
  getMementosRuntimeClient: async () => ({
    deleteBySubject: mocks.deleteBySubject,
  }),
  lifecycleCleanup: {} as never,
  lifecycleContext: {
    projects: { getProject: () => undefined },
    workspaceBootstrap: {} as never,
  },
  sessionCleanup: {
    resolve: vi.fn(async () => ({
      acpConversationIds: [],
      tuiConversationIds: [],
      terminalSessionIds: [],
      tmuxSessionNames: [],
    })),
    killAcp: vi.fn(),
    killTerminals: vi.fn(),
  },
  telemetry: { capture: mocks.capture },
  unregisterFileSearchRoot: mocks.unregisterFileSearchRoot,
} as never;

describe('delete-task operation convergence', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let handle: OperationsEngineHandle | undefined;

  afterEach(async () => {
    await handle?.dispose();
    handle = undefined;
    fixture?.close();
    vi.clearAllMocks();
  });

  it('purges remaining task data and becomes a no-op when run again', async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      workspaceProvider: 'local',
    });
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Task',
      status: 'in_progress',
      deletedAt: '2026-07-20T00:00:00.000Z',
    });
    const definition = createDeleteTaskOperationDefinition(dependencies);
    const context = {
      operation: operation(),
      db: fixture.db,
      signal: new AbortController().signal,
      clock: new ManualClock(),
      reportProgress: vi.fn(),
    };

    await expect(definition.run(context)).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(await fixture.db.select().from(tasks)).toHaveLength(0);
    expect(mocks.deleteBySubject).toHaveBeenCalledTimes(1);

    await expect(definition.run(context)).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(mocks.deleteBySubject).toHaveBeenCalledTimes(1);
  });

  it('runs through the durable engine and completes the intent row', async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      workspaceProvider: 'local',
    });
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Task',
      status: 'in_progress',
      deletedAt: '2026-07-20T00:00:00.000Z',
    });
    const taskDefinition = createDeleteTaskOperationDefinition(dependencies);
    const definitions = operationKinds.map((kind) =>
      kind === 'delete-task' ? taskDefinition : successfulDefinition(kind)
    );
    handle = await createOperationsEngine({
      scope: createScope({ label: 'delete-task-engine-test' }),
      db: fixture.db,
      sshManager: {
        on: vi.fn(),
        off: vi.fn(),
        isConnected: () => true,
      },
      notifications: { publishPendingCleanup: vi.fn() },
      definitions,
    });

    await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: {
          kind: 'delete-task',
          projectId: 'project-1',
          taskId: 'task-1',
          entityKey: 'task-1',
          hostRef: 'local',
          payload: { version: '1', source: 'user', deleteWorktree: true },
        },
      })
    );
    await handle.engine.waitForIdle();

    expect(await fixture.db.select().from(tasks)).toHaveLength(0);
    const [intent] = await fixture.db.select().from(lifecycleOperations);
    expect(intent).toMatchObject({ status: 'succeeded', attempt: 1 });
  });

  it('allows sequential deletes for tasks sharing one workspace', async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(sshConnections).values({
      id: 'ssh-1',
      name: 'Remote',
      host: 'example.com',
      username: 'dev',
    });
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      workspaceProvider: 'ssh',
      sshConnectionId: 'ssh-1',
    });
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'project-ssh',
      kind: 'worktree',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: '/repo/workspace',
      branchName: 'task-branch',
    });
    await fixture.db.insert(tasks).values([
      {
        id: 'task-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        name: 'Task 1',
        status: 'in_progress',
      },
      {
        id: 'task-2',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        name: 'Task 2',
        status: 'in_progress',
      },
    ]);
    const taskDefinition = createDeleteTaskOperationDefinition(dependencies);
    const definitions = operationKinds.map((kind) =>
      kind === 'delete-task' ? taskDefinition : successfulDefinition(kind)
    );
    handle = await createOperationsEngine({
      scope: createScope({ label: 'delete-task-shared-workspace-test' }),
      db: fixture.db,
      sshManager: {
        on: vi.fn(),
        off: vi.fn(),
        isConnected: () => false,
      },
      notifications: { publishPendingCleanup: vi.fn() },
      definitions,
    });

    const first = await enqueueDeleteTask(handle.engine, { taskId: 'task-1' });
    const second = await enqueueDeleteTask(handle.engine, { taskId: 'task-2' });
    const claims = await fixture.db.select().from(operationClaims);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(claims.filter((claim) => claim.resourceKey === 'workspace:workspace-1')).toHaveLength(1);
  });

  it('unregisters a remote task workspace root from its runtime host', async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      workspaceProvider: 'local',
    });
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'byoi',
      kind: 'byoi',
      location: 'remote',
      path: null,
    });
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      name: 'Task',
      status: 'in_progress',
      deletedAt: '2026-07-20T00:00:00.000Z',
    });
    const definition = createDeleteTaskOperationDefinition(dependencies);

    await expect(
      definition.run({
        operation: operation({
          workspaceId: 'workspace-1',
          hostRef: 'ssh-1',
          payload: {
            version: '1',
            source: 'user',
            workspacePath: '/repo/workspace',
            deleteWorktree: true,
            deleteBranch: false,
          },
        }),
        db: fixture.db,
        signal: new AbortController().signal,
        clock: new ManualClock(),
        reportProgress: vi.fn(),
      })
    ).resolves.toEqual({
      success: true,
      data: undefined,
    });

    expect(mocks.unregisterFileSearchRoot).toHaveBeenCalledWith(
      expect.anything(),
      hostRef('remote', 'ssh-1')
    );
  });
});

function operation(overrides: Partial<LifecycleOperationRow> = {}): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind: 'delete-task',
    status: 'running',
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: null,
    entityKey: 'task-1',
    parentOperationId: null,
    initiatedBy: null,
    hostRef: 'local',
    payload: {
      version: '1',
      source: 'user',
      deleteWorktree: true,
      deleteBranch: false,
    },
    attempt: 0,
    error: null,
    createdAt: 0,
    finishedAt: null,
    ...overrides,
  };
}

function successfulDefinition(kind: OperationKind): OperationDefinition {
  return {
    kind,
    entityKind:
      kind === 'delete-project'
        ? 'project'
        : kind === 'delete-automation'
          ? 'automation'
          : kind === 'delete-workspace' || kind === 'archive-workspace'
            ? 'workspace'
            : 'task',
    async run() {
      return ok(undefined);
    },
    async describe() {
      return {};
    },
  };
}

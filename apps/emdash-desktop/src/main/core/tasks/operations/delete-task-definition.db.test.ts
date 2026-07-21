import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { ManualClock } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { operationKinds, type OperationKind } from '@core/primitives/operations/api';
import {
  lifecycleOperations,
  projects,
  tasks,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import {
  createOperationsEngine,
  type OperationDefinition,
  type OperationsEngineHandle,
} from '@core/services/operations/node';
import { createDeleteTaskOperationDefinition } from './delete-task-definition';

const mocks = vi.hoisted(() => ({
  deleteBySubject: vi.fn(async () => ({ success: true, data: { deleted: 1 } })),
  capture: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: () => undefined,
  },
}));

vi.mock('@main/gateway/desktop-workers', () => ({
  getMementosRuntimeClient: async () => ({
    deleteBySubject: mocks.deleteBySubject,
  }),
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.capture },
}));

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
    const definition = createDeleteTaskOperationDefinition();
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
    const taskDefinition = createDeleteTaskOperationDefinition();
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
});

function operation(): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind: 'delete-task',
    status: 'running',
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: null,
    entityKey: 'task-1',
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
  };
}

function successfulDefinition(kind: OperationKind): OperationDefinition {
  return {
    kind,
    entityKind:
      kind === 'delete-project'
        ? 'project'
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

import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { systemClock } from '@emdash/shared/scheduling';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lifecycleOperations,
  operationClaims,
  projects,
  sshConnections,
  tasks,
  workspaces,
} from '@core/services/app-db/node/schema';
import {
  createOperationsEngine,
  type OperationsEngineHandle,
} from '@core/services/operations/node';
import { testOperationDefinitions } from '@core/services/operations/node/testing/test-definitions';
import {
  createDeleteProjectOperationDefinition,
  enqueueDeleteProject,
} from './delete-project-definition';

describe('delete-project operation definition', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let handle: OperationsEngineHandle | undefined;

  afterEach(async () => {
    await handle?.dispose();
    handle = undefined;
    fixture?.close();
  });

  it('waits only for explicit child operations', async () => {
    fixture = await openFixture('baseline');
    const definition = createDefinition();
    const [project] = await fixture.db.select().from(projects).limit(1);
    const [task] = await fixture.db.select().from(tasks).limit(1);
    expect(project).toBeDefined();
    expect(task).toBeDefined();

    await fixture.db.insert(lifecycleOperations).values([
      operationRow({
        id: 'delete-project',
        kind: 'delete-project',
        projectId: project!.id,
        entityKey: project!.id,
      }),
      operationRow({
        id: 'delete-task-child',
        kind: 'delete-task',
        projectId: project!.id,
        taskId: task!.id,
        entityKey: task!.id,
        parentOperationId: 'delete-project',
      }),
      operationRow({
        id: 'archive-unrelated',
        kind: 'archive-workspace',
        projectId: project!.id,
        entityKey: 'workspace-unrelated',
      }),
    ]);

    const [parent] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, 'delete-project'));
    expect(await definition.isReady?.({ operation: parent, db: fixture.db })).toBe(false);

    await fixture.db
      .update(lifecycleOperations)
      .set({ status: 'succeeded' })
      .where(eq(lifecycleOperations.id, 'delete-task-child'));
    expect(await definition.isReady?.({ operation: parent, db: fixture.db })).toBe(true);
  });

  it('retries parent and children only', async () => {
    fixture = await openFixture('baseline');
    const definition = createDefinition();
    const [project] = await fixture.db.select().from(projects).limit(1);
    const [task] = await fixture.db.select().from(tasks).limit(1);
    expect(project).toBeDefined();
    expect(task).toBeDefined();

    await fixture.db.insert(lifecycleOperations).values([
      operationRow({
        id: 'delete-project',
        kind: 'delete-project',
        status: 'failed',
        projectId: project!.id,
        entityKey: project!.id,
      }),
      operationRow({
        id: 'delete-task-child',
        kind: 'delete-task',
        status: 'failed',
        projectId: project!.id,
        taskId: task!.id,
        entityKey: task!.id,
        parentOperationId: 'delete-project',
      }),
      operationRow({
        id: 'archive-unrelated',
        kind: 'archive-workspace',
        status: 'failed',
        projectId: project!.id,
        entityKey: 'workspace-unrelated',
      }),
    ]);
    const [parent] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, 'delete-project'));
    const resetIds: string[] = [];

    await definition.retry?.({
      operation: parent,
      db: fixture.db,
      clock: systemClock,
      reset: (_tx, operation = parent) => resetIds.push(operation.id),
    });

    expect(resetIds.sort()).toEqual(['delete-project', 'delete-task-child']);
  });

  it('enqueues shared-workspace child deletes without conflicting sibling claims', async () => {
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
    const definition = createDefinition();
    const definitions = testOperationDefinitions({ 'delete-project': definition });
    handle = await createOperationsEngine({
      scope: createScope({ label: 'delete-project-shared-workspace-test' }),
      db: fixture.db,
      sshManager: {
        on: vi.fn(),
        off: vi.fn(),
        isConnected: () => false,
      },
      notifications: { publishPendingCleanup: vi.fn() },
      definitions,
    });

    const result = await enqueueDeleteProject(handle.engine, 'project-1');
    const operations = await fixture.db.select().from(lifecycleOperations);
    const claims = await fixture.db.select().from(operationClaims);

    expect(result.success).toBe(true);
    expect(operations.filter((operation) => operation.kind === 'delete-task')).toHaveLength(2);
    expect(claims.filter((claim) => claim.resourceKey === 'workspace:workspace-1')).toHaveLength(1);
  });
});

function createDefinition() {
  return createDeleteProjectOperationDefinition({
    automations: { removeProjectDeployments: vi.fn() },
    getMementosRuntimeClient: vi.fn(async () => ({
      deleteBySubject: vi.fn(async () => ok(undefined)),
      deleteOrphans: vi.fn(async () => ok(undefined)),
    })) as never,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
    projects: { closeProject: vi.fn(async () => ok(undefined)) },
    pullRequests: { deleteProjectData: vi.fn(async () => undefined) },
    telemetry: { capture: vi.fn() },
  });
}

function operationRow(input: {
  id: string;
  kind: 'delete-project' | 'delete-task' | 'archive-workspace';
  status?: 'pending' | 'failed';
  projectId: string;
  taskId?: string;
  entityKey: string;
  parentOperationId?: string;
}) {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status ?? 'pending',
    projectId: input.projectId,
    taskId: input.taskId,
    entityKey: input.entityKey,
    parentOperationId: input.parentOperationId,
    hostRef: 'local',
    payload: { version: '1' as const, source: 'user' as const },
    createdAt: 1,
  };
}

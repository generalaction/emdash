import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { openFixture } from '@tooling/utils/db';
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

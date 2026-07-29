import { hostRef } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { ManualClock } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  automationRuns,
  automations,
  lifecycleOperations,
  projects,
  sshConnections,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import {
  createOperationsEngine,
  type OperationDefinition,
  type OperationsEngineHandle,
} from '@core/services/operations/node';
import { testOperationDefinitions } from '@core/services/operations/node/testing/test-definitions';
import {
  createDeleteAutomationOperationDefinition,
  enqueueDeleteAutomation,
  submitReconcilerAutomationCleanup,
} from './delete-automation-definition';

const mocks = vi.hoisted(() => ({
  cancelRun: vi.fn(),
  client: vi.fn(),
  listRuns: vi.fn(),
  remove: vi.fn(),
}));

describe('delete-automation operation convergence', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let handle: OperationsEngineHandle | undefined;

  afterEach(async () => {
    await handle?.dispose();
    handle = undefined;
    fixture?.close();
    vi.clearAllMocks();
  });

  it('cancels active runs, removes the deployment, and purges local rows', async () => {
    fixture = await openFixture('empty');
    await insertAutomation(fixture.db);
    await fixture.db.insert(automationRuns).values({
      id: 'run-1',
      automationId: 'automation-1',
      automationName: 'Nightly review',
      status: 'scheduled',
      seq: 1,
    });
    mocks.listRuns.mockImplementation(async ({ status, before }) => ({
      success: true,
      data: {
        runs:
          status === 'scheduled' && before === undefined
            ? [
                {
                  id: 'run-1',
                  seq: 1,
                  status: 'scheduled',
                },
              ]
            : [],
      },
    }));
    mocks.cancelRun.mockResolvedValue({ success: true, data: undefined });
    mocks.remove.mockResolvedValue({ success: true, data: undefined });
    mocks.client.mockResolvedValue(ok(runtimeClient()));
    const definition = createDeleteAutomationOperationDefinition({
      runtimes: { client: mocks.client },
    });

    await expect(
      definition.run({
        operation: operation(),
        db: fixture.db,
        signal: new AbortController().signal,
        clock: new ManualClock(),
        reportProgress: vi.fn(),
      })
    ).resolves.toEqual({ success: true, data: undefined });

    expect(mocks.client).toHaveBeenCalledWith(hostRef('remote', 'ssh-1'));
    expect(mocks.cancelRun).toHaveBeenCalledWith({
      automationId: 'automation-1',
      runId: 'run-1',
    });
    expect(mocks.remove).toHaveBeenCalledWith({ automationId: 'automation-1' });
    expect(await fixture.db.select().from(automationRuns)).toHaveLength(0);
    expect(await fixture.db.select().from(automations)).toHaveLength(0);
  });

  it('tombstones immediately and parks remote cleanup while the host is offline', async () => {
    fixture = await openFixture('empty');
    await insertRemoteProject(fixture.db);
    await insertAutomation(fixture.db, { projectId: 'project-1' });
    const clock = new ManualClock();
    handle = await createOperationsEngine({
      scope: createScope({ label: 'delete-automation-enqueue-test' }),
      db: fixture.db,
      clock,
      sshManager: {
        on: vi.fn(),
        off: vi.fn(),
        isConnected: () => false,
      },
      notifications: { publishPendingCleanup: vi.fn() },
      definitions: definitions(
        createDeleteAutomationOperationDefinition({ runtimes: {} as never })
      ),
    });

    const result = await enqueueDeleteAutomation(handle.engine, 'automation-1');
    await handle.engine.waitForIdle();

    expect(result.success).toBe(true);
    const [automation] = await fixture.db.select().from(automations);
    expect(automation.deletedAt).toBe(0);
    const [intent] = await fixture.db.select().from(lifecycleOperations);
    expect(intent).toMatchObject({
      kind: 'delete-automation',
      status: 'pending',
      entityKey: 'automation-1',
      hostRef: 'ssh-1',
    });
  });

  it('reconciles tombstoned automations into pending cleanup', async () => {
    fixture = await openFixture('empty');
    await insertRemoteProject(fixture.db);
    await insertAutomation(fixture.db, { projectId: 'project-1', deletedAt: 10 });
    const clock = new ManualClock();
    handle = await createOperationsEngine({
      scope: createScope({ label: 'delete-automation-reconciler-test' }),
      db: fixture.db,
      clock,
      sshManager: {
        on: vi.fn(),
        off: vi.fn(),
        isConnected: () => false,
      },
      notifications: { publishPendingCleanup: vi.fn() },
      definitions: definitions(
        createDeleteAutomationOperationDefinition({ runtimes: {} as never })
      ),
    });

    await submitReconcilerAutomationCleanup(handle.engine.submit, 'automation-1');

    const [intent] = await fixture.db.select().from(lifecycleOperations);
    expect(intent).toMatchObject({
      kind: 'delete-automation',
      status: 'awaiting-confirmation',
      entityKey: 'automation-1',
      hostRef: 'ssh-1',
      payload: expect.objectContaining({
        source: 'reconciler',
        confirmationReason: 'reconciler-proposed',
      }),
    });
  });
});

function operation(overrides: Partial<LifecycleOperationRow> = {}): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind: 'delete-automation',
    status: 'running',
    projectId: 'project-1',
    taskId: null,
    workspaceId: null,
    entityKey: 'automation-1',
    parentOperationId: null,
    initiatedBy: null,
    hostRef: 'ssh-1',
    payload: {
      version: '1',
      source: 'user',
      entityName: 'Nightly review',
    },
    attempt: 0,
    error: null,
    createdAt: 0,
    finishedAt: null,
    ...overrides,
  };
}

async function insertRemoteProject(db: Awaited<ReturnType<typeof openFixture>>['db']) {
  await db.insert(sshConnections).values({
    id: 'ssh-1',
    name: 'Remote',
    host: 'example.test',
    username: 'agent',
  });
  await db.insert(projects).values({
    id: 'project-1',
    name: 'Project',
    path: '/repo',
    workspaceProvider: 'ssh',
    sshConnectionId: 'ssh-1',
  });
}

async function insertAutomation(
  db: Awaited<ReturnType<typeof openFixture>>['db'],
  overrides: Partial<typeof automations.$inferInsert> = {}
) {
  await db.insert(automations).values({
    id: 'automation-1',
    name: 'Nightly review',
    projectId: null,
    enabled: 1,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  });
}

function runtimeClient() {
  return {
    automations: {
      cancelRun: mocks.cancelRun,
      listRuns: mocks.listRuns,
      remove: mocks.remove,
    },
  };
}

function definitions(deleteAutomation: OperationDefinition): OperationDefinition[] {
  return testOperationDefinitions({ 'delete-automation': deleteAutomation });
}

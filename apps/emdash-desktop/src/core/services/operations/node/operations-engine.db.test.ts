import { err, ok, type Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred, ManualClock } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { operationKinds, type OperationKind } from '@core/primitives/operations/api';
import type { DeletionList } from '@core/primitives/operations/api';
import { lifecycleOperations } from '@core/services/app-db/node/schema';
import type {
  OperationDefinition,
  OperationRunError,
  OperationsNotificationPublisher,
  OperationsSshManager,
} from './definition';
import { createOperationsEngine, type OperationsEngineHandle } from './factory';

describe('OperationsEngine', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let handle: OperationsEngineHandle | undefined;

  afterEach(async () => {
    await handle?.dispose();
    handle = undefined;
    fixture?.close();
  });

  it('durably enqueues, runs, and completes an operation', async () => {
    fixture = await openFixture('empty');
    const run = vi.fn(async () => ok(undefined));
    handle = await createTestEngine({ run });

    const result = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-1'),
      })
    );
    await handle.engine.waitForIdle();

    expect(result.success && result.data.operationId).toBeTruthy();
    expect(run).toHaveBeenCalledTimes(1);
    const [row] = await fixture.db.select().from(lifecycleOperations);
    expect(row).toMatchObject({ status: 'succeeded', attempt: 1, entityKey: 'task-1' });
  });

  it('deduplicates pending operations by entity key', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });

    const first = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-1', 'remote-1'),
        options: { dedupeStatuses: ['pending', 'running', 'awaiting-confirmation', 'failed'] },
      })
    );
    const second = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-1', 'remote-1'),
        options: { dedupeStatuses: ['pending', 'running', 'awaiting-confirmation', 'failed'] },
      })
    );
    await handle.engine.waitForIdle();

    expect(first).toEqual(second);
    expect(await fixture.db.select().from(lifecycleOperations)).toHaveLength(1);
  });

  it('parks remote work until the SSH host reconnects', async () => {
    fixture = await openFixture('empty');
    const run = vi.fn(async () => ok(undefined));
    const ssh = createSshManager(false);
    handle = await createTestEngine({ run, ssh });

    await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1', 'remote-1') })
    );
    await handle.engine.waitForIdle();
    expect(await operationStatus()).toBe('pending');
    expect(run).not.toHaveBeenCalled();
    const lease = handle.engine.acquireDeletionState('task', 'task-1');
    const source = await lease.ready();
    const list = (await source.snapshot()).data as DeletionList;
    expect(list['task-1']).toMatchObject({
      status: 'blocked-host-offline',
      entityName: 'task-1',
      hostRef: 'remote-1',
    });
    await lease.release();

    ssh.connect();
    await handle.engine.waitForIdle();
    expect(await operationStatus()).toBe('succeeded');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('allows forgetting cleanup that is pending on an offline host', async () => {
    fixture = await openFixture('empty');
    const run = vi.fn(async () => ok(undefined));
    handle = await createTestEngine({ run, ssh: createSshManager(false) });

    await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1', 'remote-1') })
    );
    await handle.engine.waitForIdle();

    const result = await handle.engine.forgetWithoutCleanup('task', 'task-1');
    const [row] = await fixture.db.select().from(lifecycleOperations);
    expect(result.success).toBe(true);
    expect(row).toMatchObject({ status: 'abandoned', error: null });
    expect(run).not.toHaveBeenCalled();
  });

  it('allows retrying cleanup that is pending on an offline host', async () => {
    fixture = await openFixture('empty');
    const clock = new ManualClock(1_000);
    const run = vi.fn(async () => ok(undefined));
    const ssh = createSshManager(false);
    handle = await createTestEngine({ run, ssh, clock });

    await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1', 'remote-1') })
    );
    await handle.engine.waitForIdle();

    const result = await handle.engine.retryDelete('task', 'task-1');
    let [row] = await fixture.db.select().from(lifecycleOperations);
    expect(result.success).toBe(true);
    expect(row).toMatchObject({
      status: 'pending',
      error: null,
      payload: { confirmedAt: 1_000 },
    });
    expect(run).not.toHaveBeenCalled();

    ssh.connect();
    await handle.engine.waitForIdle();
    [row] = await fixture.db.select().from(lifecycleOperations);
    expect(row).toMatchObject({ status: 'succeeded', attempt: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries the whole convergent operation after a transient failure', async () => {
    fixture = await openFixture('empty');
    const clock = new ManualClock(1_000);
    const run = vi
      .fn<() => Promise<Result<void, OperationRunError>>>()
      .mockResolvedValueOnce(
        err({
          type: 'failed',
          code: 'temporary',
          message: 'try again',
          retryable: true,
        })
      )
      .mockResolvedValue(ok(undefined));
    handle = await createTestEngine({ run, clock });

    await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1') })
    );
    const idle = handle.engine.waitForIdle();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await clock.advanceBy(1_000);
    await idle;

    expect(run).toHaveBeenCalledTimes(2);
    expect(await operationStatus()).toBe('succeeded');
  });

  it('resets interrupted running rows and resumes them on startup', async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(lifecycleOperations).values({
      ...operationDraft('task-1'),
      id: 'operation-1',
      status: 'running',
      attempt: 1,
      projectId: null,
      taskId: 'task-1',
      workspaceId: null,
      createdAt: 1,
    });
    const run = vi.fn(async () => ok(undefined));

    handle = await createTestEngine({ run });
    await handle.engine.waitForIdle();

    expect(run).toHaveBeenCalledTimes(1);
    const [row] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, 'operation-1'));
    expect(row).toMatchObject({ status: 'succeeded', attempt: 2 });
  });

  it('fails rows with missing definitions and continues draining later rows', async () => {
    fixture = await openFixture('empty');
    const run = vi.fn(async () => ok(undefined));
    handle = await createTestEngine({ run });

    await fixture.db.insert(lifecycleOperations).values([
      {
        ...operationDraft('orphan-1'),
        id: 'operation-orphan',
        kind: 'missing-operation' as OperationKind,
        status: 'pending',
        projectId: null,
        taskId: null,
        workspaceId: null,
        createdAt: 1,
      },
      {
        ...operationDraft('task-1'),
        id: 'operation-task',
        status: 'pending',
        projectId: null,
        taskId: 'task-1',
        workspaceId: null,
        createdAt: 2,
      },
    ]);

    handle.engine.poke();
    await handle.engine.waitForIdle();

    const rows = await fixture.db.select().from(lifecycleOperations);
    expect(rows.find((row) => row.id === 'operation-orphan')).toMatchObject({
      status: 'failed',
      error: "No operation definition is registered for 'missing-operation'",
    });
    expect(rows.find((row) => row.id === 'operation-task')).toMatchObject({
      status: 'succeeded',
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('parks confirmation requests without consuming an attempt and resumes after retry', async () => {
    fixture = await openFixture('empty');
    const publishPendingCleanup = vi.fn<OperationsNotificationPublisher['publishPendingCleanup']>();
    const notifications = { publishPendingCleanup };
    const run = vi
      .fn<OperationDefinition['run']>()
      .mockResolvedValueOnce(err({ type: 'awaiting-confirmation', reason: 'workspace-modified' }))
      .mockResolvedValue(ok(undefined));
    handle = await createTestEngine({ run, notifications });

    await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1') })
    );
    await handle.engine.waitForIdle();
    let [row] = await fixture.db.select().from(lifecycleOperations);
    expect(row).toMatchObject({
      status: 'awaiting-confirmation',
      attempt: 0,
      payload: { confirmationReason: 'workspace-modified' },
    });
    expect(publishPendingCleanup).toHaveBeenCalledTimes(1);

    await handle.engine.retryDelete('task', 'task-1');
    await handle.engine.waitForIdle();
    [row] = await fixture.db.select().from(lifecycleOperations);
    expect(row).toMatchObject({ status: 'succeeded', attempt: 1 });
  });

  it('projects running operations with waiting progress as waiting cleanups', async () => {
    fixture = await openFixture('empty');
    const releaseRun = deferred<void>();
    const run = vi.fn<OperationDefinition['run']>(async (context) => {
      context.reportProgress({
        currentStep: 'deactivate-workspace',
        completedSteps: 0,
        totalSteps: 1,
        waiting: true,
      });
      await releaseRun.promise;
      return ok(undefined);
    });
    handle = await createTestEngine({ run });

    await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1') })
    );
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    const lease = handle.engine.acquireDeletionState('task', 'task-1');
    const source = await lease.ready();
    const list = (await source.snapshot()).data as DeletionList;
    expect(list['task-1']).toMatchObject({
      status: 'waiting',
      currentStep: 'deactivate-workspace',
    });
    await lease.release();

    releaseRun.resolve();
    await handle.engine.waitForIdle();
  });

  it('runs operations on another host while a host lane is blocked', async () => {
    fixture = await openFixture('empty');
    const releaseRemote = deferred<void>();
    const calls: string[] = [];
    const run = vi.fn<OperationDefinition['run']>(async ({ operation }) => {
      calls.push(operation.entityKey ?? operation.id);
      if (operation.hostRef === 'remote-1') await releaseRemote.promise;
      return ok(undefined);
    });
    handle = await createTestEngine({ run });

    await fixture.db
      .insert(lifecycleOperations)
      .values([operationRow('remote-task', 'remote-1', 1), operationRow('local-task', 'local', 2)]);

    handle.engine.poke();
    await vi.waitFor(() => expect(calls).toEqual(['remote-task', 'local-task']));

    const localRow = await operationByEntityKey('local-task');
    expect(localRow).toMatchObject({ status: 'succeeded' });

    releaseRemote.resolve();
    await handle.engine.waitForIdle();
    expect(await operationStatusByEntityKey('remote-task')).toBe('succeeded');
  });

  it('preserves FIFO order within a host lane', async () => {
    fixture = await openFixture('empty');
    const calls: string[] = [];
    const run = vi.fn<OperationDefinition['run']>(async ({ operation }) => {
      calls.push(operation.entityKey ?? operation.id);
      return ok(undefined);
    });
    handle = await createTestEngine({ run });

    await fixture.db
      .insert(lifecycleOperations)
      .values([
        operationRow('remote-1', 'remote-1', 1),
        operationRow('remote-2', 'remote-1', 2),
        operationRow('remote-3', 'remote-1', 3),
      ]);

    handle.engine.poke();
    await handle.engine.waitForIdle();

    expect(calls).toEqual(['remote-1', 'remote-2', 'remote-3']);
  });

  it('runs definition reconciliation through the generic scheduler', async () => {
    fixture = await openFixture('empty');
    const reconcile = vi.fn<NonNullable<OperationDefinition['reconcile']>>(async ({ submit }) => {
      await submit(async () =>
        ok({
          outcome: 'enqueue',
          draft: {
            kind: 'cleanup-sessions',
            entityKey: 'orphan-1',
            hostRef: 'local',
            payload: { version: '1', source: 'reconciler' },
          },
        })
      );
    });
    handle = await createTestEngine({ reconcile });

    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    await handle.engine.waitForIdle();

    const [row] = await fixture.db.select().from(lifecycleOperations);
    expect(row).toMatchObject({
      kind: 'cleanup-sessions',
      entityKey: 'orphan-1',
      status: 'succeeded',
    });
  });

  async function createTestEngine(options: {
    run?: OperationDefinition['run'];
    ssh?: ReturnType<typeof createSshManager>;
    clock?: ManualClock;
    notifications?: OperationsNotificationPublisher;
    reconcile?: OperationDefinition['reconcile'];
  }): Promise<OperationsEngineHandle> {
    const run = options.run ?? (async () => ok(undefined));
    const definitions = operationKinds.map((kind) =>
      definition(kind, run, kind === 'cleanup-sessions' ? options.reconcile : undefined)
    );
    return createOperationsEngine({
      scope: createScope({ label: 'operations-engine-test', clock: options.clock }),
      db: fixture.db,
      sshManager: options.ssh ?? createSshManager(true),
      notifications: options.notifications ?? { publishPendingCleanup: vi.fn() },
      definitions,
      clock: options.clock,
    });
  }

  async function operationStatus() {
    const [row] = await fixture.db.select().from(lifecycleOperations);
    return row?.status;
  }

  async function operationByEntityKey(entityKey: string) {
    const [row] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.entityKey, entityKey));
    return row;
  }

  async function operationStatusByEntityKey(entityKey: string) {
    return (await operationByEntityKey(entityKey))?.status;
  }
});

function definition(
  kind: OperationKind,
  run: OperationDefinition['run'],
  reconcile?: OperationDefinition['reconcile']
): OperationDefinition {
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
    run,
    reconcile,
    async describe({ operation }) {
      return { entityName: operation.payload.entityName };
    },
  };
}

function operationDraft(entityKey: string, hostRef = 'local') {
  return {
    kind: 'delete-task' as const,
    entityKey,
    hostRef,
    taskId: entityKey,
    payload: {
      version: '1' as const,
      source: 'user' as const,
      entityName: entityKey,
    },
  };
}

function operationRow(entityKey: string, hostRef: string, createdAt: number) {
  return {
    ...operationDraft(entityKey, hostRef),
    id: `operation-${entityKey}`,
    status: 'pending' as const,
    projectId: null,
    workspaceId: null,
    createdAt,
  };
}

function createSshManager(initiallyConnected: boolean): OperationsSshManager & {
  connect(): void;
} {
  let connected = initiallyConnected;
  let listener: ((event: { type: string }) => void) | undefined;
  return {
    on(_eventName, nextListener) {
      listener = nextListener;
    },
    off() {
      listener = undefined;
    },
    isConnected() {
      return connected;
    },
    connect() {
      connected = true;
      listener?.({ type: 'connected' });
    },
  };
}

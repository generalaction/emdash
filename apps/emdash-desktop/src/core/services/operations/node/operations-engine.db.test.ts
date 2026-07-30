import { err, ok, type Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred, ManualClock } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import z from 'zod';
import {
  defineOperationKindPayloadSchema,
  type OperationDisplayState,
  operationKinds,
  type OperationKind,
  type OperationTreeList,
  rollupStatus,
} from '@core/primitives/operations/api';
import { lifecycleOperations, operationClaims, projects } from '@core/services/app-db/node/schema';
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

  it('adopts deduplicated related operations under the new parent', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });

    const child = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-1', 'remote-1'),
        options: { dedupeStatuses: ['pending', 'running', 'awaiting-confirmation', 'failed'] },
      })
    );
    const parent = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: {
          kind: 'delete-project' as const,
          entityKey: 'project-1',
          projectId: 'project-1',
          hostRef: 'local',
          payload: { version: '2', source: 'user', entityName: 'Project' },
        },
        related: [
          {
            draft: operationDraft('task-1', 'remote-1'),
            options: { dedupeStatuses: ['pending', 'running', 'awaiting-confirmation', 'failed'] },
          },
        ],
      })
    );
    await handle.engine.waitForIdle();

    const [childRow] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, child.success ? child.data.operationId! : ''));
    expect(childRow.parentOperationId).toBe(parent.success ? parent.data.operationId : undefined);
  });

  it('keeps parents in waiting-children until child operations settle', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    const run = vi.fn(async () => ok(undefined));
    handle = await createTestEngine({ run, ssh });

    const parent = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: {
          kind: 'delete-project' as const,
          entityKey: 'project-1',
          projectId: 'project-1',
          hostRef: 'local',
          payload: { version: '2', source: 'user', entityName: 'Project' },
        },
        related: [
          {
            draft: operationDraft('task-1', 'remote-1'),
          },
        ],
      })
    );
    await handle.engine.waitForIdle();

    const parentId = parent.success ? parent.data.operationId! : '';
    expect(await operationById(parentId)).toMatchObject({ status: 'waiting-children' });
    expect(run).not.toHaveBeenCalled();

    ssh.connect();
    await handle.engine.waitForIdle();

    expect(await operationById(parentId)).toMatchObject({ status: 'succeeded' });
    expect(await operationStatusByEntityKey('task-1')).toBe('succeeded');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('applies parent forget policies to child operations', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });

    const parent = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: {
          kind: 'delete-project' as const,
          entityKey: 'project-1',
          projectId: 'project-1',
          hostRef: 'local',
          payload: { version: '2', source: 'user', entityName: 'Project' },
        },
        related: [
          {
            draft: operationDraft('task-abandon', 'remote-1'),
            propagation: { onParentForget: 'abandon-children' as const },
          },
          {
            draft: operationDraft('task-orphan', 'remote-1'),
            propagation: { onParentForget: 'orphan-children' as const },
          },
        ],
      })
    );
    const parentId = parent.success ? parent.data.operationId! : '';

    await handle.engine.forget(parentId);

    expect(await operationStatusByEntityKey('task-abandon')).toBe('abandoned');
    expect(await operationByEntityKey('task-orphan')).toMatchObject({
      status: 'pending',
      parentOperationId: null,
      parentForgetPolicy: null,
    });
  });

  it('rejects conflicting operation claims and frees claims after terminal status', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });

    const first = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-1', 'remote-1'),
        options: {
          claims: [{ kind: 'workspace', id: 'workspace-1' }],
        },
      })
    );
    const conflict = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-2', 'remote-1'),
        options: {
          claims: [{ kind: 'workspace', id: 'workspace-1' }],
        },
      })
    );
    expect(first.success).toBe(true);
    expect(conflict).toEqual(
      err({
        type: 'resource-claimed',
        message: `Resource is already claimed by operation ${
          first.success ? first.data.operationId : ''
        }`,
      })
    );

    await fixture.db
      .update(lifecycleOperations)
      .set({ status: 'abandoned' })
      .where(eq(lifecycleOperations.id, first.success ? first.data.operationId! : ''));
    const next = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-2', 'remote-1'),
        options: {
          claims: [{ kind: 'workspace', id: 'workspace-1' }],
        },
      })
    );
    expect(next.success).toBe(true);
    expect(await fixture.db.select().from(operationClaims)).toHaveLength(2);
  });

  it('rejects payload fields that do not belong to the operation kind', async () => {
    fixture = await openFixture('empty');
    handle = await createTestEngine({});

    const result = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: {
          kind: 'delete-project' as const,
          projectId: 'project-1',
          entityKey: 'project-1',
          hostRef: 'local',
          payload: {
            version: '2' as const,
            source: 'user' as const,
            entityName: 'Project',
            deleteWorktree: true,
          },
        },
      })
    );

    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.type).toBe('invalid-operation-payload');
    expect(await fixture.db.select().from(lifecycleOperations)).toHaveLength(0);
  });

  it('rejects claim conflicts before committing tombstones', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      workspaceProvider: 'local',
    });

    const first = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-1', 'remote-1'),
        options: {
          claims: [{ kind: 'project', id: 'project-1' }],
        },
      })
    );
    const conflict = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('project-1', 'remote-1'),
        options: {
          claims: [{ kind: 'project', id: 'project-1' }],
          tombstone: (tx) =>
            tx
              .update(projects)
              .set({ deletedAt: '2026-07-29T00:00:00.000Z' })
              .where(eq(projects.id, 'project-1'))
              .run().changes,
        },
      })
    );

    expect(first.success).toBe(true);
    expect(conflict.success).toBe(false);
    const [project] = await fixture.db.select().from(projects);
    expect(project.deletedAt).toBeNull();
  });

  it('rolls back parent inserts when a related operation fails admission', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      workspaceProvider: 'local',
    });
    await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: operationDraft('task-1', 'remote-1'),
        options: {
          claims: [{ kind: 'workspace', id: 'workspace-1' }],
        },
      })
    );

    const result = await handle.engine.submit(async () =>
      ok({
        outcome: 'enqueue',
        draft: {
          kind: 'delete-project' as const,
          entityKey: 'project-1',
          projectId: 'project-1',
          hostRef: 'local',
          payload: { version: '2', source: 'user', entityName: 'Project' },
        },
        options: {
          claims: [{ kind: 'project', id: 'project-1' }],
          tombstone: (tx) =>
            tx
              .update(projects)
              .set({ deletedAt: '2026-07-29T00:00:00.000Z' })
              .where(eq(projects.id, 'project-1'))
              .run().changes,
        },
        related: [
          {
            draft: operationDraft('task-2', 'remote-1'),
            options: {
              claims: [{ kind: 'workspace', id: 'workspace-1' }],
            },
          },
        ],
      })
    );

    expect(result.success).toBe(false);
    const rows = await fixture.db.select().from(lifecycleOperations);
    expect(rows.map((row) => row.entityKey)).toEqual(['task-1']);
    const [project] = await fixture.db.select().from(projects);
    expect(project.deletedAt).toBeNull();
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
    const lease = handle.engine.acquireOperationTreeState();
    const source = await lease.ready();
    const list = (await source.snapshot()).data as OperationTreeList;
    expect(Object.values(list)[0]?.root).toMatchObject({
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

    const submission = await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1', 'remote-1') })
    );
    await handle.engine.waitForIdle();

    const result = await handle.engine.forget(
      submission.success ? submission.data.operationId! : ''
    );
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

    const submission = await handle.engine.submit(async () =>
      ok({ outcome: 'enqueue', draft: operationDraft('task-1', 'remote-1') })
    );
    await handle.engine.waitForIdle();

    const result = await handle.engine.retry(
      submission.success ? submission.data.operationId! : ''
    );
    let [row] = await fixture.db.select().from(lifecycleOperations);
    expect(result.success).toBe(true);
    expect(row).toMatchObject({
      status: 'pending',
      error: null,
      confirmedAt: 1_000,
      confirmationReason: null,
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
      confirmationReason: 'workspace-modified',
    });
    expect(publishPendingCleanup).toHaveBeenCalledTimes(1);

    const [pendingRow] = await fixture.db.select().from(lifecycleOperations);
    await handle.engine.retry(pendingRow.id);
    await handle.engine.waitForIdle();
    [row] = await fixture.db.select().from(lifecycleOperations);
    expect(row).toMatchObject({ status: 'succeeded', attempt: 1, confirmedAt: expect.any(Number) });
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

    const lease = handle.engine.acquireOperationTreeState();
    const source = await lease.ready();
    const list = (await source.snapshot()).data as OperationTreeList;
    expect(Object.values(list)[0]?.root).toMatchObject({
      status: 'waiting',
      currentStep: 'deactivate-workspace',
    });
    await lease.release();

    releaseRun.resolve();
    await handle.engine.waitForIdle();
  });

  it('promotes non-terminal operations with terminal parents to tree roots', async () => {
    fixture = await openFixture('empty');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });
    await fixture.db.insert(lifecycleOperations).values([
      {
        ...operationRow('project-1', 'local', 1),
        id: 'operation-parent',
        kind: 'delete-project',
        status: 'succeeded',
        projectId: 'project-1',
        taskId: null,
      },
      {
        ...operationRow('task-1', 'remote-1', 2),
        id: 'operation-child',
        parentOperationId: 'operation-parent',
        projectId: 'project-1',
      },
    ]);

    const lease = handle.engine.acquireOperationTreeState('project-1');
    const source = await lease.ready();
    const list = (await source.snapshot()).data as OperationTreeList;
    await lease.release();

    expect(Object.keys(list)).toEqual(['operation-child']);
    expect(list['operation-child']?.root).toMatchObject({
      operationId: 'operation-child',
      entityId: 'task-1',
      status: 'blocked-host-offline',
    });
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
            payload: { version: '2', source: 'reconciler' },
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

  it('rolls operation tree status up by severity', () => {
    expect(
      rollupStatus([operationDisplayState('cleaning'), operationDisplayState('waiting')])
    ).toBe('cleaning');
    expect(rollupStatus([operationDisplayState('cleaning'), operationDisplayState('failed')])).toBe(
      'failed'
    );
    expect(
      rollupStatus([
        operationDisplayState('blocked-host-offline'),
        operationDisplayState('waiting'),
      ])
    ).toBe('blocked-host-offline');
    expect(rollupStatus([])).toBe('waiting');
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

  async function operationById(operationId: string) {
    const [row] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, operationId));
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
    payloadSchema: kind === 'delete-project' ? deleteProjectPayloadSchema : undefined,
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

const deleteProjectPayloadSchema = defineOperationKindPayloadSchema({
  entityName: z.string().optional(),
  hostLabel: z.string().optional(),
});

function operationDraft(entityKey: string, hostRef = 'local') {
  return {
    kind: 'delete-task' as const,
    entityKey,
    hostRef,
    taskId: entityKey,
    payload: {
      version: '2' as const,
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

function operationDisplayState(status: OperationDisplayState['status']): OperationDisplayState {
  return {
    operationId: `operation-${status}`,
    operationKind: 'delete-task',
    entityId: `entity-${status}`,
    entityKind: 'task',
    hostRef: 'local',
    createdAt: 1,
    attempt: 0,
    status,
    ...(status === 'failed' ? { error: 'failed' } : {}),
    ...(status === 'awaiting-confirmation' ? { confirmationReason: 'stale' as const } : {}),
  } as OperationDisplayState;
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

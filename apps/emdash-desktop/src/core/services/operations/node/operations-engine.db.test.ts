import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatHostRef,
  hostRef,
  LOCAL_HOST_REF,
  serializedHostRefSchema,
} from '@emdash/core/primitives/host/api';
import {
  createOperationHandler,
  defineOperation,
  defineResource,
  type AnyOperationDefinition,
} from '@emdash/core/primitives/kernel/api';
import type { OperationTreeList } from '@emdash/core/primitives/operations/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import type { ManualClock } from '@emdash/shared/testing';
import { snapshot } from '@emdash/wire';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import z from 'zod';
import { projects } from '@core/services/app-db/node/schema';
import {
  needsConfirmation,
  operationErrorSchema,
  operationResultSchema,
  rejectOperationOutcome,
  type OperationDefinition,
  type OperationsNotificationPublisher,
  type OperationsSshManager,
} from '@core/services/operations/node';
import { createOperationsEngine, type OperationsEngineHandle } from './factory';

const testResource = defineResource<'test', { key: string }>({
  name: 'test',
  key: (ref) => `test:${ref.key}`,
});

const testInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      source: z.enum(['user', 'reconciler']),
      key: z.string(),
      hostRef: serializedHostRefSchema,
      projectId: z.string().optional(),
      workspacePath: z.string().optional(),
      claimKey: z.string().optional(),
      fail: z.boolean().optional(),
      confirmedAt: z.number().int().nonnegative().optional(),
      createdAt: z.number().int().nonnegative(),
    })
  )
  .build();

type TestInput = typeof testInputSchema.Type;

const testOperation = defineOperation({
  name: 'test-cleanup',
  input: testInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `test:${input.key}`,
  claims: (input) => (input.claimKey ? testResource.mutates({ key: input.claimKey }) : []),
  retry: { maxAttempts: 1, backoff: { kind: 'fixed', baseMs: 1 } },
});

const parentOperation = defineOperation({
  name: 'parent-cleanup',
  input: testInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `parent:${input.key}`,
  claims: () => [],
  retry: { maxAttempts: 1, backoff: { kind: 'fixed', baseMs: 1 } },
});

describe('OperationsEngine', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>> | undefined;
  let handle: OperationsEngineHandle | undefined;
  let scope: Scope | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await handle?.dispose();
    await scope?.dispose();
    fixture?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    handle = undefined;
    scope = undefined;
    fixture = undefined;
    tempDir = undefined;
  });

  it('reverts tombstones when kernel admission rejects after the app-db write', async () => {
    fixture = await openFixture('empty');
    await insertProject('project-1');
    await insertProject('project-2');
    const ssh = createSshManager(false);
    handle = await createTestEngine({ ssh });

    const first = await handle.engine.submitWithTombstone(
      testOperation,
      testInput({
        key: 'first',
        hostRef: formatHostRef(hostRef('remote', 'remote-1')),
        claimKey: 'shared',
      }),
      {
        tombstone: (tx) =>
          tx
            .update(projects)
            .set({ deletedAt: 'deleted' })
            .where(eq(projects.id, 'project-1'))
            .run().changes,
      }
    );
    const rejected = await handle.engine.submitWithTombstone(
      testOperation,
      testInput({ key: 'second', claimKey: 'shared' }),
      {
        tombstone: (tx) =>
          tx
            .update(projects)
            .set({ deletedAt: 'deleted' })
            .where(eq(projects.id, 'project-2'))
            .run().changes,
        revertTombstone: (tx) => {
          tx.update(projects).set({ deletedAt: null }).where(eq(projects.id, 'project-2')).run();
        },
      }
    );

    expect(first.success).toBe(true);
    expect(rejected).toMatchObject({
      success: false,
      error: { type: 'resource-claimed' },
    });
    await expectProjectDeletedAt('project-1', 'deleted');
    await expectProjectDeletedAt('project-2', null);
  });

  it('does not accumulate rejected reconciler proposals and prunes the old record on retry', async () => {
    fixture = await openFixture('empty');
    const publishPendingCleanup = vi.fn();
    handle = await createTestEngine({
      notifications: { publishPendingCleanup },
      reconcile: async (context) => {
        const input = testInput({ key: 'orphan', source: 'reconciler', workspacePath: '/orphan' });
        if (await context.hasActiveKey(testOperation.key(input))) return;
        await context.submit(testOperation, input);
      },
    });
    await handle.engine.waitForIdle();

    let list = await operationTreeList(handle.engine);
    const [tree] = Object.values(list);
    expect(Object.values(list)).toHaveLength(1);
    expect(tree?.root.status).toBe('awaiting-confirmation');
    expect(publishPendingCleanup).toHaveBeenCalledTimes(1);

    await privateSweep(handle.engine);
    await handle.engine.waitForIdle();
    list = await operationTreeList(handle.engine);
    expect(Object.values(list)).toHaveLength(1);
    expect(publishPendingCleanup).toHaveBeenCalledTimes(1);

    await handle.engine.retry(tree!.root.operationId);
    await handle.engine.waitForIdle();
    expect(await operationTreeList(handle.engine)).toEqual({});
  });

  it('retains succeeded parents when a child failed', async () => {
    fixture = await openFixture('empty');
    handle = await createTestEngine({});

    const submitted = await handle.engine.submitWithTombstone(
      parentOperation,
      testInput({ key: 'parent', workspacePath: '/repo' })
    );
    expect(submitted.success).toBe(true);
    await handle.engine.waitForIdle();

    const [tree] = Object.values(await operationTreeList(handle.engine));
    expect(tree?.root.status).toBe('succeeded');
    expect(tree?.children[0]).toMatchObject({ status: 'failed' });
    expect(tree?.rollup).toMatchObject({ total: 2, done: 1, status: 'failed' });
  });

  async function createTestEngine(options: {
    ssh?: ReturnType<typeof createSshManager>;
    clock?: ManualClock;
    notifications?: OperationsNotificationPublisher;
    reconcile?: OperationDefinition<typeof testOperation>['reconcile'];
  }): Promise<OperationsEngineHandle> {
    tempDir = await mkdtemp(join(tmpdir(), 'emdash-operations-engine-'));
    scope = createScope({ label: 'operations-engine-test', clock: options.clock });
    return createOperationsEngine({
      scope,
      db: fixture!.db,
      databasePath: join(tempDir, 'operations.db'),
      sshManager: options.ssh ?? createSshManager(true),
      notifications: options.notifications ?? { publishPendingCleanup: vi.fn() },
      definitions: [
        testOperationDefinition(options.reconcile),
        parentOperationDefinition(),
      ] as OperationDefinition<AnyOperationDefinition>[],
      conflictPolicies: [],
      logger: { warn: vi.fn() },
      clock: options.clock,
    });
  }

  async function insertProject(id: string): Promise<void> {
    await fixture!.db.insert(projects).values({ id, name: id, path: `/${id}` });
  }

  async function expectProjectDeletedAt(id: string, deletedAt: string | null): Promise<void> {
    const [project] = await fixture!.db
      .select({ deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, id));
    expect(project?.deletedAt).toBe(deletedAt);
  }
});

function testOperationDefinition(
  reconcile?: OperationDefinition<typeof testOperation>['reconcile']
): OperationDefinition<typeof testOperation> {
  return {
    definition: testOperation,
    handler: createOperationHandler(testOperation, async (ctx) => {
      if (ctx.input.source === 'reconciler' && !ctx.input.confirmedAt) {
        await Promise.resolve();
        rejectOperationOutcome(ctx, needsConfirmation('reconciler-proposed'));
      }
      if (ctx.input.fail) {
        throw new Error('child failed');
      }
      return { ok: true as const };
    }),
    entityKind: 'workspace',
    displayName: 'Testing cleanup',
    examples: [{ definition: testOperation, input: testInput({ key: 'example' }) }],
    ...(reconcile ? { reconcile } : {}),
  };
}

function parentOperationDefinition(): OperationDefinition<typeof parentOperation> {
  return {
    definition: parentOperation,
    handler: createOperationHandler(parentOperation, async (ctx) => {
      await ctx.run(
        testOperation,
        testInput({
          key: `${ctx.input.key}:child`,
          workspacePath: ctx.input.workspacePath,
          fail: true,
        })
      );
      return { ok: true as const };
    }),
    entityKind: 'project',
    displayName: 'Testing parent cleanup',
    examples: [{ definition: parentOperation, input: testInput({ key: 'parent-example' }) }],
  };
}

function testInput(input: Partial<TestInput> & { key: string }): TestInput {
  return {
    version: '1',
    source: input.source ?? 'user',
    key: input.key,
    hostRef: input.hostRef ?? formatHostRef(LOCAL_HOST_REF),
    projectId: input.projectId,
    workspacePath: input.workspacePath,
    claimKey: input.claimKey,
    fail: input.fail,
    confirmedAt: input.confirmedAt,
    createdAt: input.createdAt ?? 1,
  };
}

async function operationTreeList(
  engine: OperationsEngineHandle['engine']
): Promise<OperationTreeList> {
  const scope = createScope({ label: 'operation-tree-list-test' });
  try {
    const state = engine.operationTreeState({}, scope);
    await state.refresh();
    return snapshot(state).value ?? {};
  } finally {
    await scope.dispose();
  }
}

async function privateSweep(engine: OperationsEngineHandle['engine']): Promise<void> {
  await (engine as unknown as { sweep(): Promise<void> }).sweep();
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
    isConnected(_connectionId) {
      return connected;
    },
    connect() {
      connected = true;
      listener?.({ type: 'connected' });
    },
  };
}

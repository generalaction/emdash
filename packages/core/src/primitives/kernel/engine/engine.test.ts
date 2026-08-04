import { createScope } from '@emdash/shared/concurrency';
import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineConflictPolicy } from '../api/conflict-policy';
import { defineOperation, type AnyOperationDefinition } from '../api/definition';
import { createOperationHandler } from '../api/handler';
import type { OperationRecord } from '../api/record';
import type { ResourceClaim } from '../api/resources';
import { CaptureProgressSink, FakeClock } from '../testing/harness';
import { MemoryOperationStore } from '../testing/memory-store';
import { createOperationEngine } from './engine';

const schema = defineVersionedSchema()
  .unversioned(z.object({ key: z.string() }))
  .build();
const resultSchema = z.object({ ok: z.boolean(), value: z.string().optional() });
const errorSchema = z.object({ code: z.string() });

const claim = (key: string, mode: ResourceClaim['mode'] = 'exclusive'): ResourceClaim => ({
  resource: 'resource',
  key,
  mode,
  implicit: false,
});

function op(name: string, mode: ResourceClaim['mode'] = 'exclusive'): AnyOperationDefinition {
  return defineOperation({
    name,
    input: schema,
    result: resultSchema,
    error: errorSchema,
    key: (input) => `${name}:${input.key}`,
    claims: (input) => [claim(input.key, mode)],
    retry: { maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 10 } },
  });
}

function engineFor(
  handlers: ReturnType<typeof createOperationHandler>[],
  opts: {
    store?: MemoryOperationStore;
    clock?: FakeClock;
    conflicts?: ReturnType<typeof defineConflictPolicy>;
    dispatchGate?: (record: OperationRecord) => boolean;
  } = {}
) {
  const progress = new CaptureProgressSink();
  const clock = opts.clock ?? new FakeClock(1);
  const store = opts.store ?? new MemoryOperationStore({ now: () => clock.now() });
  const engine = createOperationEngine({
    store,
    progress,
    clock,
    ids: idSequence(),
    dispatchGate: opts.dispatchGate,
    registry: {
      definitions: handlers.map((handler) => handler.definition),
      handlers,
      conflictPolicies: opts.conflicts ? [opts.conflicts] : [],
    },
  });
  return { engine, store, progress, clock };
}

describe('createOperationEngine', () => {
  test('runs a full lifecycle with typed result and progress snapshots', async () => {
    const definition = op('scan', 'shared');
    const handler = createOperationHandler(definition, async (ctx) => {
      await ctx.stage('probe', 'Probe', async () => undefined);
      return { ok: true, value: ctx.input.key };
    });
    const { engine, progress } = engineFor([handler]);
    const scope = createScope();

    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'scan' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;

    const followed: string[] = [];
    submitted.data.follow((update) => followed.push(update.stages.at(-1)?.id ?? 'none'), { scope });
    await expect(submitted.data.result).resolves.toEqual({
      success: true,
      data: { ok: true, value: 'a' },
    });
    expect(progress.ended).toEqual([submitted.data.id]);
    expect(followed).toContain('probe');
    await scope.dispose();
  });

  test('records an explicitly non-fatal failed stage while completing the operation', async () => {
    const definition = op('best-effort');
    const handler = createOperationHandler(definition, async (ctx) => {
      await ctx.stage('cleanup', 'Cleanup', async (stage) => {
        stage.fail(new Error('cleanup failed'));
      });
      return { ok: true };
    });
    const { engine, progress } = engineFor([handler]);

    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      { initiator: { kind: 'reconciler', probe: 'cleanup' } }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;

    await expect(submitted.data.result).resolves.toEqual({
      success: true,
      data: { ok: true },
    });
    expect(progress.published.at(-1)?.stages).toEqual([
      {
        id: 'cleanup',
        label: 'Cleanup',
        status: 'failed',
        nonFatal: true,
        error: { message: 'cleanup failed' },
      },
    ]);
    expect((await engine.get(submitted.data.id))?.outcome).toEqual({
      version: '2',
      stages: [
        {
          id: 'cleanup',
          label: 'Cleanup',
          status: 'failed',
          nonFatal: true,
          error: { message: 'cleanup failed' },
        },
      ],
    });
  });

  test('retries with backoff and preserves the claim until success', async () => {
    const definition = op('flaky');
    let attempts = 0;
    const handler = createOperationHandler(definition, async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('try again');
      }
      return { ok: true };
    });
    const { engine, clock } = engineFor([handler]);

    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'test' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;

    await flushMicrotasks(50);
    clock.advance(10);

    await expect(submitted.data.result).resolves.toEqual({ success: true, data: { ok: true } });
    expect(attempts).toBe(2);
  });

  test('supersedes running incumbents by aborting them before dispatching the newcomer', async () => {
    const provision = op('provision');
    const teardown = op('teardown');
    const provisionHandler = createOperationHandler(provision, async (ctx) => {
      await waitForAbort(ctx.signal);
      throw new Error('aborted');
    });
    const teardownHandler = createOperationHandler(teardown, async () => ({ ok: true }));
    const conflicts = defineConflictPolicy((on) => {
      on(teardown, provision).supersede();
    });
    const { engine } = engineFor([provisionHandler, teardownHandler], { conflicts });

    const first = await engine.submit(
      provision,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'provision' },
      }
    );
    expect(first.success).toBe(true);
    await flushMicrotasks(50);

    const second = await engine.submit(
      teardown,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'teardown' },
      }
    );
    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;

    await expect(first.data.result).resolves.toEqual({
      success: false,
      error: { kind: 'superseded' },
    });
    await expect(second.data.result).resolves.toEqual({ success: true, data: { ok: true } });
  });

  test('shutdown resets running work to pending instead of cancelling it', async () => {
    const definition = op('long');
    const handler = createOperationHandler(definition, async (ctx) => {
      await waitForAbort(ctx.signal);
      throw new Error('aborted');
    });
    const { engine } = engineFor([handler]);
    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'test' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;
    await flushMicrotasks();

    await engine.shutdown();

    expect((await engine.get(submitted.data.id))?.status).toBe('pending');
  });

  test('recovery resets running records to pending', async () => {
    const definition = op('recover');
    const handler = createOperationHandler(definition, async () => ({ ok: true }));
    const { engine, store } = engineFor([handler]);
    await store.transaction((tx) => {
      const inserted = tx.insert({
        id: 'stuck',
        name: definition.name,
        key: 'recover:a',
        input: { version: '1', key: 'a' },
        claims: [claim('a')],
        status: 'pending',
        attempt: 0,
        initiator: { kind: 'user', action: 'test' },
        createdAt: 1,
        updatedAt: 1,
      });
      tx.transition(inserted.id, 'pending', 'running', 'dispatch');
    });

    await engine.recover();

    expect((await engine.get('stuck'))?.status).toBe('pending');
  });

  test('ctx.run resumes by deduping a settled child result', async () => {
    const child = op('child');
    const parent = op('parent');
    let childRuns = 0;
    let parentRuns = 0;
    const childHandler = createOperationHandler(child, async () => {
      childRuns += 1;
      return { ok: true, value: 'child-result' };
    });
    const parentHandler = createOperationHandler(parent, async (ctx) => {
      parentRuns += 1;
      const childResult = await ctx.run(child, { key: ctx.input.key });
      if (childResult.success) {
        const value = childResult.data.value;
        if (parentRuns === 1) {
          throw new Error('simulate crash after child');
        }
        return { ok: true, value };
      } else {
        ctx.reject({ code: 'child-failed' });
      }
    });
    const { engine, clock } = engineFor([parentHandler, childHandler]);

    const submitted = await engine.submit(
      parent,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'parent' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;

    await waitForCondition(async () => {
      const record = await engine.get(submitted.data.id);
      return record?.status === 'pending' && record.attempt === 1;
    });
    clock.advance(10);
    await flushMicrotasks(50);

    await expect(submitted.data.result).resolves.toEqual({
      success: true,
      data: { ok: true, value: 'child-result' },
    });
    expect(parentRuns).toBe(2);
    expect(childRuns).toBe(1);
  });

  test('cancels an awaited child when the parent is cancelled', async () => {
    const child = op('child');
    const parent = op('parent');
    const childHandler = createOperationHandler(child, async (ctx) => {
      await waitForAbort(ctx.signal);
      throw new Error('child aborted');
    });
    const parentHandler = createOperationHandler(parent, async (ctx) => {
      const childResult = await ctx.run(child, { key: ctx.input.key });
      if (!childResult.success) {
        ctx.reject({ code: 'child-failed' });
      }
      return { ok: true };
    });
    const { engine } = engineFor([parentHandler, childHandler]);
    const submitted = await engine.submit(
      parent,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'parent' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;
    await waitForCondition(async () => (await engine.query({})).records.length === 2);

    await submitted.data.cancel();

    await expect(submitted.data.result).resolves.toEqual({
      success: false,
      error: { kind: 'cancelled' },
    });
  });

  test('batch duplicate handles resolve to real ids and parent links', async () => {
    const child = op('child');
    const dependent = op('dependent');
    const childHandler = createOperationHandler(child, async () => ({ ok: true, value: 'child' }));
    const dependentHandler = createOperationHandler(dependent, async () => ({ ok: true }));
    const { engine } = engineFor([childHandler, dependentHandler]);

    const submitted = await engine.submitBatch(
      [
        { definition: child, input: { key: 'a' } },
        { definition: child, input: { key: 'a' } },
        { definition: dependent, input: { key: 'b' }, parent: 1 },
      ],
      { initiator: { kind: 'user', action: 'batch' } }
    );

    expect(submitted.success).toBe(true);
    if (!submitted.success) return;
    expect(submitted.data.handles[0]?.id).toBe(submitted.data.handles[1]?.id);
    expect(submitted.data.handles[0]?.id).not.toMatch(/^batch:/);
    await expect(submitted.data.handles[1]?.result).resolves.toEqual({
      success: true,
      data: { ok: true, value: 'child' },
    });
    const dependentRecord = await engine.get(submitted.data.handles[2]?.id ?? '');
    expect(dependentRecord?.parentId).toBe(submitted.data.handles[0]?.id);
  });

  test('cancelling a pending child settles a waiting parent', async () => {
    const parent = op('parent');
    const child = op('child');
    const { engine, store } = engineFor([
      createOperationHandler(parent, async () => ({ ok: true })),
      createOperationHandler(child, async () => ({ ok: true })),
    ]);
    await store.transaction((tx) => {
      const parentRecord = tx.insert({
        id: 'parent',
        name: parent.name,
        key: 'parent:a',
        input: { key: 'a' },
        claims: [claim('a')],
        status: 'pending',
        attempt: 0,
        initiator: { kind: 'user', action: 'test' },
        createdAt: 1,
        updatedAt: 1,
      });
      tx.transition(parentRecord.id, 'pending', 'running', 'dispatch');
      tx.transition(parentRecord.id, 'running', 'waiting-children', 'settle');
      tx.insert({
        id: 'child',
        name: child.name,
        key: 'child:a',
        input: { key: 'a' },
        claims: [claim('a')],
        status: 'pending',
        attempt: 0,
        parentId: parentRecord.id,
        initiator: { kind: 'operation', operationId: parentRecord.id },
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await engine.cancel('child');

    expect((await engine.get('parent'))?.status).toBe('cancelled');
  });

  test('superseding a pending child settles a waiting parent', async () => {
    const parent = op('parent');
    const child = op('child');
    const teardown = op('teardown');
    const conflicts = defineConflictPolicy((on) => {
      on(teardown, child).supersede();
    });
    const { engine, store } = engineFor(
      [
        createOperationHandler(parent, async () => ({ ok: true })),
        createOperationHandler(child, async () => ({ ok: true })),
        createOperationHandler(teardown, async () => ({ ok: true })),
      ],
      { conflicts }
    );
    await store.transaction((tx) => {
      const parentRecord = tx.insert({
        id: 'parent',
        name: parent.name,
        key: 'parent:a',
        input: { key: 'a' },
        claims: [claim('parent')],
        status: 'pending',
        attempt: 0,
        initiator: { kind: 'user', action: 'test' },
        createdAt: 1,
        updatedAt: 1,
      });
      tx.transition(parentRecord.id, 'pending', 'running', 'dispatch');
      tx.transition(parentRecord.id, 'running', 'waiting-children', 'settle');
      tx.insert({
        id: 'child',
        name: child.name,
        key: 'child:a',
        input: { key: 'a' },
        claims: [claim('a')],
        status: 'pending',
        attempt: 0,
        parentId: parentRecord.id,
        initiator: { kind: 'operation', operationId: parentRecord.id },
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const submitted = await engine.submit(
      teardown,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'teardown' },
      }
    );

    expect(submitted.success).toBe(true);
    expect((await engine.get('parent'))?.status).toBe('succeeded');
  });

  test('result waiters survive settlement between initial get and registration check', async () => {
    const definition = op('race');
    const store = new DelayedSnapshotGetStore();
    const handler = createOperationHandler(definition, async () => ({ ok: true }));
    const { engine } = engineFor([handler], { store });

    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'race' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;

    await waitForCondition(
      async () => (await engine.get(submitted.data.id))?.status === 'succeeded'
    );
    store.releaseDelayedGet();

    await expect(submitted.data.result).resolves.toEqual({ success: true, data: { ok: true } });
  });

  test('shutdown prevents a queued dispatch pass from starting new work', async () => {
    const definition = op('queued-shutdown');
    let starts = 0;
    const handler = createOperationHandler(definition, async () => {
      starts += 1;
      return { ok: true };
    });
    const { engine } = engineFor([handler]);

    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'test' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;

    await engine.shutdown();

    expect(starts).toBe(0);
    expect((await engine.get(submitted.data.id))?.status).toBe('pending');
  });

  test('exposes the latest dispatch report including deferred records', async () => {
    const definition = op('deferred');
    const handler = createOperationHandler(definition, async () => ({ ok: true }));
    const { engine } = engineFor([handler], { dispatchGate: () => false });

    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'test' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;
    await flushMicrotasks(20);

    expect(engine.lastDispatchReport()).toEqual({
      started: [],
      skipped: [],
      deferred: [{ id: submitted.data.id, reason: 'gated' }],
    });
  });

  test('poke wakes work that was deferred by the dispatch gate', async () => {
    const definition = op('gate-poke');
    let open = false;
    let starts = 0;
    const handler = createOperationHandler(definition, async () => {
      starts += 1;
      return { ok: true };
    });
    const { engine } = engineFor([handler], { dispatchGate: () => open });

    const submitted = await engine.submit(
      definition,
      { key: 'a' },
      {
        initiator: { kind: 'user', action: 'test' },
      }
    );
    expect(submitted.success).toBe(true);
    if (!submitted.success) return;
    await flushMicrotasks(20);
    expect(starts).toBe(0);
    expect((await engine.get(submitted.data.id))?.status).toBe('pending');

    open = true;
    engine.poke();
    await expect(submitted.data.result).resolves.toEqual({ success: true, data: { ok: true } });
    expect(starts).toBe(1);
  });
});

class DelayedSnapshotGetStore extends MemoryOperationStore {
  private delayedGet: (() => void) | undefined;
  private delayed = false;

  override async get(id: string): Promise<OperationRecord | undefined> {
    if (!this.delayed) {
      this.delayed = true;
      const snapshot = await super.get(id);
      return new Promise((resolve) => {
        this.delayedGet = () => resolve(snapshot);
      });
    }
    return super.get(id);
  }

  releaseDelayedGet(): void {
    this.delayedGet?.();
    this.delayedGet = undefined;
  }
}

function idSequence(): () => string {
  let index = 0;
  return () => `op${++index}`;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function flushMicrotasks(count = 10): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) {
      return;
    }
    await flushMicrotasks();
  }
  throw new Error('Timed out waiting for condition');
}

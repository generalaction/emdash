import {
  defineMemento,
  mementosWireContract,
  type MementoCatalogEntry,
} from '@core/primitives/mementos/api';
import { defineSubject } from '@core/primitives/subjects/api';
import { MementoService } from '@core/services/mementos/node/memento-service';
import {
  MementoPersistenceService,
  mementosSqliteStore,
} from '@core/services/mementos/node/persistence';
import { createMementosWireController } from '@core/services/mementos/node/wire-controller';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { waitFor } from '@emdash/shared/testing';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import { autorun, observable, reaction, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MementoClient } from './memento-client';
import { sanitizedMemento } from './sanitized';

const taskSubject = defineSubject({
  kind: 'task',
  key: z.object({ taskId: z.string() }),
  encode: ({ taskId }) => taskId,
});

const drawerV1Schema = z.object({
  version: z.literal('1'),
  open: z.boolean(),
});
const drawerV2Schema = z.object({
  version: z.literal('2'),
  open: z.boolean(),
  height: z.number(),
});
const drawerSchema = defineVersionedSchema()
  .initial('1', drawerV1Schema)
  .version('2', drawerV2Schema, (value) => ({
    version: '2' as const,
    open: value.open,
    height: 240,
  }))
  .build();
const drawerMemento = defineMemento({
  id: 'tasks.drawer',
  subject: taskSubject,
  schema: drawerSchema,
  default: { version: '2' as const, open: false, height: 240 },
});
const editorMemento = defineMemento({
  id: 'tasks.editor',
  subject: taskSubject,
  schema: drawerSchema,
  default: { version: '2' as const, open: false, height: 240 },
});
const transientMemento = defineMemento({
  id: 'tasks.scroll',
  subject: taskSubject,
  schema: drawerSchema,
  default: { version: '2' as const, open: false, height: 0 },
  retention: { tier: 'transient', maxEntries: 1 },
});

describe('MementoClient', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(cleanups.splice(0).map(async (cleanup) => await cleanup()));
  });

  it('hydrates one memento and migrates its version on read', async () => {
    const setup = await createSetup(cleanups);
    setup.persistence.upsert(
      { mementoId: drawerMemento.id, kind: 'task', key: 'task-1' },
      {
        version: '1',
        data: JSON.stringify({ version: '1', open: true }),
        updatedAt: 1,
      }
    );
    const space = setup.client.subject(taskSubject({ taskId: 'task-1' }));
    const handle = space.handle(drawerMemento);

    await space.ready;

    expect(handle.value).toEqual({ version: '2', open: true, height: 240 });
  });

  it('prefetches cataloged mementos before a subject space becomes ready', async () => {
    const setup = await createSetup(cleanups, { catalog: [drawerMemento] });
    setup.persistence.upsert(
      { mementoId: drawerMemento.id, kind: 'task', key: 'task-1' },
      {
        version: '2',
        data: JSON.stringify({ version: '2', open: true, height: 300 }),
        updatedAt: 1,
      }
    );
    const space = setup.client.subject(taskSubject({ taskId: 'task-1' }));
    await space.ready;
    setup.persistence.deleteAll();

    expect(space.handle(drawerMemento).value).toEqual({
      version: '2',
      open: true,
      height: 300,
    });
  });

  it('falls back to the default for missing, invalid, and future-version rows', async () => {
    const setup = await createSetup(cleanups);
    const missing = setup.client.subject(taskSubject({ taskId: 'missing' }));
    const invalid = setup.client.subject(taskSubject({ taskId: 'invalid' }));
    const future = setup.client.subject(taskSubject({ taskId: 'future' }));
    setup.persistence.upsert(
      { mementoId: drawerMemento.id, kind: 'task', key: 'invalid' },
      { version: '1', data: '{broken', updatedAt: 1 }
    );
    setup.persistence.upsert(
      { mementoId: drawerMemento.id, kind: 'task', key: 'future' },
      { version: '99', data: '{"version":"99","open":true}', updatedAt: 1 }
    );
    const handles = [
      missing.handle(drawerMemento),
      invalid.handle(drawerMemento),
      future.handle(drawerMemento),
    ];

    await Promise.all([missing.ready, invalid.ready, future.ready]);

    expect(handles.map(({ value }) => value)).toEqual([
      drawerMemento.default,
      drawerMemento.default,
      drawerMemento.default,
    ]);
  });

  it('debounces persistence and preserves value identity across the authoritative echo', async () => {
    vi.useFakeTimers();
    const setup = await createSetup(cleanups, { debounceMs: 50 });
    const space = setup.client.subject(taskSubject({ taskId: 'task-1' }));
    const handle = space.handle(drawerMemento);
    await handle.ready;
    const observed: unknown[] = [];
    const disposeReaction = reaction(
      () => handle.value,
      (value) => observed.push(value)
    );

    const next = { version: '2' as const, open: true, height: 320 };
    handle.update(next);
    expect(handle.value).toBe(next);
    expect(setup.persistence.snapshot()).toEqual([]);

    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => setup.persistence.snapshot().length === 1);

    expect(handle.value).toBe(next);
    expect(observed).toEqual([next]);
    disposeReaction();
  });

  it('isolates reactions by memento id and subject', async () => {
    const setup = await createSetup(cleanups);
    const firstSpace = setup.client.subject(taskSubject({ taskId: 'task-1' }));
    const otherSpace = setup.client.subject(taskSubject({ taskId: 'task-2' }));
    const first = firstSpace.handle(drawerMemento);
    const sibling = firstSpace.handle(editorMemento);
    const other = otherSpace.handle(drawerMemento);
    await Promise.all([firstSpace.ready, otherSpace.ready]);
    const firstReaction = vi.fn();
    const siblingReaction = vi.fn();
    const otherReaction = vi.fn();
    const disposers = [
      reaction(() => first.value, firstReaction),
      reaction(() => sibling.value, siblingReaction),
      reaction(() => other.value, otherReaction),
    ];

    first.update({ version: '2', open: true, height: 300 });
    await first.flush();

    expect(firstReaction).toHaveBeenCalledTimes(1);
    expect(siblingReaction).not.toHaveBeenCalled();
    expect(otherReaction).not.toHaveBeenCalled();
    disposers.forEach((dispose) => dispose());
  });

  it('propagates reset to another renderer client', async () => {
    const setup = await createSetup(cleanups);
    const secondClient = new MementoClient(setup.wire.client, {
      registerBeforeUnload: false,
    });
    cleanups.push(() => secondClient.dispose());
    const first = setup.client.subject(taskSubject({ taskId: 'task-1' })).handle(drawerMemento);
    const second = secondClient.subject(taskSubject({ taskId: 'task-1' })).handle(drawerMemento);
    await Promise.all([first.ready, second.ready]);

    first.update({ version: '2', open: true, height: 300 });
    await first.flush();
    await waitFor(() => second.value.open);
    await first.reset();
    await waitFor(() => !second.value.open);

    expect(second.value).toBe(drawerMemento.default);
  });

  it('keeps transient state in an LRU and never sends wire traffic', async () => {
    const setup = await createSetup(cleanups);
    const firstSpace = setup.client.subject(taskSubject({ taskId: 'task-1' }));
    const first = firstSpace.handle(transientMemento);
    first.update({ version: '2', open: true, height: 10 });
    await firstSpace.release();

    const secondSpace = setup.client.subject(taskSubject({ taskId: 'task-2' }));
    secondSpace.handle(transientMemento).update({ version: '2', open: true, height: 20 });
    await secondSpace.release();

    const reacquired = setup.client
      .subject(taskSubject({ taskId: 'task-1' }))
      .handle(transientMemento);
    expect(reacquired.value).toBe(transientMemento.default);
    expect(setup.persistence.snapshot()).toEqual([]);
  });

  it('reacquires a released subject space without losing transient state', async () => {
    const setup = await createSetup(cleanups);
    const subject = taskSubject({ taskId: 'task-1' });
    const firstSpace = setup.client.subject(subject);
    firstSpace.handle(transientMemento).update({ version: '2', open: true, height: 10 });
    await firstSpace.release();

    const secondSpace = setup.client.subject(subject);

    expect(secondSpace.handle(transientMemento).value).toEqual({
      version: '2',
      open: true,
      height: 10,
    });
  });

  it('resets pinned transient state when its subject is deleted', async () => {
    const setup = await createSetup(cleanups);
    const subject = taskSubject({ taskId: 'task-1' });
    const transient = setup.client.subject(subject).handle(transientMemento);
    transient.update({ version: '2', open: true, height: 10 });

    await setup.client.deleteBySubject(subject);

    expect(transient.value).toBe(transientMemento.default);
  });

  it('does not resurrect a pending write after deleting its subject', async () => {
    vi.useFakeTimers();
    const setup = await createSetup(cleanups, { debounceMs: 50 });
    const subject = taskSubject({ taskId: 'task-1' });
    const handle = setup.client.subject(subject).handle(drawerMemento);
    await handle.ready;
    handle.update({ version: '2', open: true, height: 10 });

    await setup.client.deleteBySubject(subject);
    await vi.advanceTimersByTimeAsync(50);

    expect(setup.persistence.snapshot()).toEqual([]);
    expect(handle.value).toBe(drawerMemento.default);
  });

  it('deletes all persisted and transient mementos', async () => {
    const setup = await createSetup(cleanups);
    const space = setup.client.subject(taskSubject({ taskId: 'task-1' }));
    const persisted = space.handle(drawerMemento);
    const transient = space.handle(transientMemento);
    await persisted.ready;
    persisted.update({ version: '2', open: true, height: 10 });
    transient.update({ version: '2', open: true, height: 20 });
    await persisted.flush();

    await expect(setup.client.deleteAll()).resolves.toBe(1);

    expect(persisted.value).toBe(drawerMemento.default);
    expect(transient.value).toBe(transientMemento.default);
    expect(setup.persistence.snapshot()).toEqual([]);
  });

  it('deletes only orphaned persisted and transient subjects', async () => {
    const setup = await createSetup(cleanups);
    const keptSpace = setup.client.subject(taskSubject({ taskId: 'keep' }));
    const orphanSpace = setup.client.subject(taskSubject({ taskId: 'orphan' }));
    const keptPersisted = keptSpace.handle(drawerMemento);
    const orphanPersisted = orphanSpace.handle(drawerMemento);
    const keptTransient = keptSpace.handle(transientMemento);
    const orphanTransient = orphanSpace.handle(transientMemento);
    await Promise.all([keptPersisted.ready, orphanPersisted.ready]);
    keptPersisted.update({ version: '2', open: true, height: 10 });
    orphanPersisted.update({ version: '2', open: true, height: 20 });
    keptTransient.update({ version: '2', open: true, height: 30 });
    orphanTransient.update({ version: '2', open: true, height: 40 });
    await setup.client.flush();

    await expect(setup.client.deleteOrphans('task', ['keep'])).resolves.toBe(1);

    expect(keptPersisted.value.open).toBe(true);
    expect(orphanPersisted.value).toBe(drawerMemento.default);
    expect(keptTransient.value.height).toBe(30);
    expect(orphanTransient.value).toBe(transientMemento.default);
  });

  it('attempts every handle when a flush fails', async () => {
    const setup = await createSetup(cleanups);
    const firstError = new Error('first');
    const secondError = new Error('second');
    const first = { flush: vi.fn().mockRejectedValue(firstError) };
    const second = { flush: vi.fn().mockRejectedValue(secondError) };
    const handles = (
      setup.client as unknown as {
        persistentHandles: Set<{ flush(): Promise<void> }>;
      }
    ).persistentHandles;
    handles.add(first);
    handles.add(second);

    let error: unknown;
    try {
      await setup.client.flush();
    } catch (caught) {
      error = caught;
    } finally {
      handles.delete(first);
      handles.delete(second);
    }

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([firstError, secondError]);
    expect(first.flush).toHaveBeenCalledOnce();
    expect(second.flush).toHaveBeenCalledOnce();
  });

  it('sanitizes only after dependencies load and does not persist repairs', async () => {
    const setup = await createSetup(cleanups);
    const space = setup.client.subject(taskSubject({ taskId: 'task-1' }));
    const raw = space.handle(transientMemento);
    raw.update({ version: '2', open: true, height: 10 });
    const dependencies = observable.box<Set<number> | undefined>(undefined, {
      deep: false,
    });
    const sanitized = sanitizedMemento(raw, {
      deps: () => dependencies.get(),
      sanitize: (value, ids) => (ids.has(value.height) ? value : { ...value, height: 0 }),
    });
    const values: number[] = [];
    const disposeAutorun = autorun(() => values.push(sanitized.value.height));

    runInAction(() => dependencies.set(new Set()));
    runInAction(() => dependencies.set(new Set()));

    expect(values).toEqual([10, 0]);
    expect(raw.value.height).toBe(10);
    expect(setup.persistence.snapshot()).toEqual([]);
    disposeAutorun();
  });
});

async function createSetup(
  cleanups: Array<() => Promise<void>>,
  options: {
    debounceMs?: number;
    catalog?: readonly MementoCatalogEntry[];
  } = {}
): Promise<{
  client: MementoClient;
  persistence: MementoPersistenceService;
  service: MementoService;
  wire: TestWire<typeof mementosWireContract>;
}> {
  const handle = await mementosSqliteStore.openTemp();
  const persistence = new MementoPersistenceService(handle);
  const service = new MementoService({ persistence });
  const wire = createTestWire(mementosWireContract, createMementosWireController(service));
  const client = new MementoClient(wire.client, {
    debounceMs: options.debounceMs,
    catalog: options.catalog,
    registerBeforeUnload: false,
  });
  cleanups.push(async () => {
    await client.dispose();
    await wire.dispose();
    await service.dispose();
  });
  return { client, persistence, service, wire };
}

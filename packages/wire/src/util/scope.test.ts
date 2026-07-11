import { describe, expect, it, vi } from 'vitest';
import { createStubLogger, deferred } from '../testing';
import { createScope, describeScope } from './scope';

describe('createScope', () => {
  it('runs own cleanups in LIFO order', async () => {
    const events: string[] = [];
    const scope = createScope();

    scope.add(() => {
      events.push('first');
    });
    scope.add(() => {
      events.push('second');
    });
    scope.add(() => {
      events.push('third');
    });

    await scope.dispose();

    expect(events).toEqual(['third', 'second', 'first']);
  });

  it('disposes children before own cleanups', async () => {
    const events: string[] = [];
    const parent = createScope();
    const firstChild = parent.child('first');
    const secondChild = parent.child('second');

    parent.add(() => {
      events.push('parent');
    });
    firstChild.add(() => {
      events.push('first-child');
    });
    secondChild.add(() => {
      events.push('second-child');
    });

    await parent.dispose();

    expect(events).toEqual(['second-child', 'first-child', 'parent']);
  });

  it('continues disposing after cleanup errors', async () => {
    const error = new Error('boom');
    const onCleanupError = vi.fn();
    const events: string[] = [];
    const scope = createScope({ label: 'root', onCleanupError });

    scope.add(() => {
      events.push('first');
    });
    scope.add(() => {
      throw error;
    });
    scope.add(() => {
      events.push('third');
    });

    await scope.dispose();

    expect(events).toEqual(['third', 'first']);
    expect(onCleanupError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ label: 'root', labelPath: 'root' })
    );
  });

  it('is idempotent and awaits async cleanups', async () => {
    const cleanup = vi.fn(async () => {});
    const scope = createScope();
    scope.add(cleanup);

    await Promise.all([scope.dispose(), scope.dispose()]);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(scope.disposed).toBe(true);
  });

  it('exposes open, closing, and closed states', async () => {
    const cleanup = deferred<void>();
    const scope = createScope();
    scope.add(async () => cleanup.promise);

    expect(scope.state).toBe('open');
    expect(scope.disposed).toBe(false);

    const dispose = scope.dispose();
    expect(scope.state).toBe('closing');
    expect(scope.disposed).toBe(true);

    cleanup.resolve();
    await dispose;
    expect(scope.state).toBe('closed');
  });

  it('aborts the scope signal synchronously when disposal starts', async () => {
    const scope = createScope();
    const cleanup = deferred<void>();
    scope.add(async () => cleanup.promise);

    const dispose = scope.dispose('closing');

    expect(scope.signal.aborted).toBe(true);
    expect(scope.signal.reason).toBe('closing');
    cleanup.resolve();
    await dispose;
  });

  it('tracks successful run exits without rejecting exit', async () => {
    const scope = createScope();
    const run = scope.run('success', async () => 'ok');

    await expect(run.exit).resolves.toEqual({ kind: 'success', value: 'ok' });
    await expect(run.value()).resolves.toBe('ok');
    expect(describeScope(scope).runs).toEqual([]);
  });

  it('tracks failed run exits without rejecting exit', async () => {
    const error = new Error('boom');
    const { logger, calls } = createStubLogger();
    const scope = createScope({ logger });
    const run = scope.run('failure', async () => {
      throw error;
    });

    await expect(run.exit).resolves.toEqual({ kind: 'failure', error });
    await expect(run.value()).rejects.toThrow('boom');
    expect(calls).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'wire scope run failed',
      }),
    ]);
  });

  it('cancels active runs and waits for them before cleanups', async () => {
    const events: string[] = [];
    const started = deferred<void>();
    const releaseRun = deferred<void>();
    const scope = createScope();
    const run = scope.run('worker', async (signal) => {
      signal.addEventListener('abort', () => events.push('abort'), { once: true });
      started.resolve();
      await releaseRun.promise;
      events.push('run settled');
    });
    scope.add(() => {
      events.push('cleanup');
    });

    await started.promise;
    const dispose = scope.dispose('stop');
    expect(run.signal.aborted).toBe(true);
    expect(events).toEqual(['abort']);

    releaseRun.resolve();
    await dispose;

    expect(events).toEqual(['abort', 'run settled', 'cleanup']);
    await expect(run.exit).resolves.toEqual({ kind: 'cancelled', reason: 'stop' });
  });

  it('does not invoke runs started after closing begins', async () => {
    const scope = createScope();
    await scope.dispose('done');

    const operation = vi.fn();
    const run = scope.run('late', operation);

    expect(operation).not.toHaveBeenCalled();
    await expect(run.exit).resolves.toEqual({ kind: 'cancelled', reason: 'done' });
  });

  it('propagates parent disposal to child runs without cancelling siblings directly', async () => {
    const parent = createScope();
    const first = parent.child('first');
    const second = parent.child('second');
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const firstRun = first.run('first-run', async () => {
      firstStarted.resolve();
      return firstGate.promise;
    });
    const secondRun = second.run('second-run', async () => {
      secondStarted.resolve();
      return secondGate.promise;
    });

    await Promise.all([firstStarted.promise, secondStarted.promise]);
    const dispose = parent.dispose('parent closed');
    expect(firstRun.signal.aborted).toBe(true);
    expect(secondRun.signal.aborted).toBe(true);

    firstGate.resolve();
    secondGate.resolve();
    await dispose;
    await expect(firstRun.exit).resolves.toEqual({ kind: 'cancelled', reason: 'parent closed' });
    await expect(secondRun.exit).resolves.toEqual({ kind: 'cancelled', reason: 'parent closed' });
  });

  it('cancelling one run does not cancel another run in the same scope', async () => {
    const scope = createScope();
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const first = scope.run('first', async () => {
      firstStarted.resolve();
      return firstGate.promise;
    });
    const second = scope.run('second', async () => {
      secondStarted.resolve();
      return secondGate.promise;
    });

    await Promise.all([firstStarted.promise, secondStarted.promise]);
    first.cancel('only first');
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    firstGate.resolve();
    secondGate.resolve();
    await expect(first.exit).resolves.toEqual({ kind: 'cancelled', reason: 'only first' });
    await expect(second.exit).resolves.toEqual({ kind: 'success', value: undefined });
  });

  it('runs cleanup immediately when added after disposal', async () => {
    const cleanup = vi.fn();
    const scope = createScope();

    await scope.dispose();
    scope.add(cleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes resources registered through use()', async () => {
    const resource = { dispose: vi.fn(async () => {}) };
    const scope = createScope();

    expect(scope.use(resource)).toBe(resource);
    await scope.dispose();

    expect(resource.dispose).toHaveBeenCalledTimes(1);
  });

  it('deregisters individually disposed children from the parent', async () => {
    const childCleanup = vi.fn();
    const parent = createScope();
    const child = parent.child();
    child.add(childCleanup);

    await child.dispose();
    await parent.dispose();

    expect(childCleanup).toHaveBeenCalledTimes(1);
  });

  it('attaches inherited loggers to child scopes', () => {
    const { logger, calls } = createStubLogger({ component: 'test' });
    const scope = createScope({ label: 'root', logger });
    const child = scope.child('child');

    child.log.info('hello');

    expect(calls).toEqual([
      {
        level: 'info',
        message: 'hello',
        fields: { component: 'test', scope: 'root/child' },
      },
    ]);
  });

  it('describes the active scope tree', async () => {
    const parent = createScope({ label: 'parent' });
    const child = parent.child('child');
    parent.child('other');
    await child.dispose();

    expect(describeScope(parent)).toMatchObject({
      label: 'parent',
      labelPath: 'parent',
      state: 'open',
      disposed: false,
      runs: [],
      children: [{ label: 'other', labelPath: 'parent/other', disposed: false }],
    });
  });

  it('describes active runs', async () => {
    const scope = createScope({ label: 'parent' });
    const gate = deferred<void>();
    const run = scope.run('long-running', async () => gate.promise);

    expect(describeScope(scope)).toMatchObject({
      runs: [
        {
          label: 'long-running',
          startedAt: run.startedAt,
          cancelled: false,
        },
      ],
    });

    run.cancel('diagnostic');
    expect(describeScope(scope).runs[0]).toMatchObject({ cancelled: true });
    gate.resolve();
    await run.exit;
  });
});

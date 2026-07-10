import { describe, expect, it, vi } from 'vitest';
import { createStubLogger } from '../testing';
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
      disposed: false,
      children: [{ label: 'other', labelPath: 'parent/other', disposed: false }],
    });
  });
});

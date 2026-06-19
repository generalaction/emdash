import { err, ok, type Result } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindMirror } from './bind-mirror';
import { ModelMirror } from './model-mirror';

function value(v: number, sequence: number, generation = 1) {
  return { value: v, sequence, generation };
}

type NumberSnapshotResult = Result<ReturnType<typeof value>, never>;

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('bindMirror', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates from the snapshot and becomes live', async () => {
    const mirror = new ModelMirror<number>();
    const binding = bindMirror({
      mirror,
      subscribe: () => () => {},
      snapshot: async () => ok(value(10, 1)),
    });
    expect(binding.status).toBe('idle');

    binding.start();
    expect(binding.status).toBe('syncing');
    await flush();

    expect(mirror.value).toBe(10);
    expect(binding.status).toBe('live');
    binding.dispose();
    expect(binding.status).toBe('idle');
  });

  it('retries with backoff and reports error after repeated failures', async () => {
    const mirror = new ModelMirror<number>();
    let attempts = 0;
    const binding = bindMirror({
      mirror,
      subscribe: () => () => {},
      snapshot: async () => {
        attempts += 1;
        if (attempts < 4) throw new Error('nope');
        return ok(value(7, 1));
      },
    });

    binding.start();
    await flush();
    expect(attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts).toBe(3);
    expect(binding.status).toBe('error');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempts).toBe(4);
    expect(mirror.value).toBe(7);
    expect(binding.status).toBe('live');
    binding.dispose();
  });

  it('becomes live from a push even while the snapshot keeps failing', async () => {
    const mirror = new ModelMirror<number>();
    let push: ((v: ReturnType<typeof value>) => void) | undefined;
    const binding = bindMirror({
      mirror,
      subscribe: (p) => {
        push = p;
        return () => {};
      },
      snapshot: async () => {
        throw new Error('snapshot down');
      },
    });

    binding.start();
    await flush();
    expect(binding.status).not.toBe('live');

    push?.(value(42, 1));
    expect(mirror.value).toBe(42);
    expect(binding.status).toBe('live');
    binding.dispose();
  });

  it('forwards thrown snapshot errors to onUnexpectedError', async () => {
    const onUnexpectedError = vi.fn();
    const binding = bindMirror({
      mirror: new ModelMirror<number>(),
      subscribe: () => () => {},
      snapshot: async () => {
        throw new Error('kaboom');
      },
      onUnexpectedError,
    });
    binding.start();
    await flush();
    expect(onUnexpectedError).toHaveBeenCalledOnce();
    binding.dispose();
  });

  it('retries result snapshot errors and reports them through onError', async () => {
    const onError = vi.fn();
    let attempts = 0;
    const binding = bindMirror({
      mirror: new ModelMirror<number>(),
      subscribe: () => () => {},
      snapshot: async () => {
        attempts += 1;
        return err('not ready');
      },
      onError,
    });

    binding.start();
    await flush();
    expect(attempts).toBe(1);
    expect(onError).toHaveBeenLastCalledWith('not ready');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts).toBe(3);
    expect(binding.status).toBe('error');
    binding.dispose();
  });

  it('does not resync while idle', async () => {
    const mirror = new ModelMirror<number>();
    const snapshot = vi.fn(async () => ok(value(10, 1)));
    const binding = bindMirror({
      mirror,
      subscribe: () => () => {},
      snapshot,
    });

    await binding.resync();

    expect(snapshot).not.toHaveBeenCalled();
    expect(mirror.value).toBeNull();
    expect(binding.status).toBe('idle');
  });

  it('starts a fresh snapshot after dispose and restart while the previous snapshot is pending', async () => {
    const mirror = new ModelMirror<number>();
    const first = deferred<NumberSnapshotResult>();
    const second = deferred<NumberSnapshotResult>();
    const snapshot = vi
      .fn<() => Promise<NumberSnapshotResult>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const binding = bindMirror({
      mirror,
      subscribe: () => () => {},
      snapshot,
    });

    binding.start();
    expect(snapshot).toHaveBeenCalledTimes(1);

    binding.dispose();
    binding.start();
    expect(snapshot).toHaveBeenCalledTimes(2);

    first.resolve(ok(value(100, 1)));
    await flush();
    expect(mirror.value).toBeNull();
    expect(binding.status).toBe('syncing');

    second.resolve(ok(value(200, 1)));
    await flush();
    expect(mirror.value).toBe(200);
    expect(binding.status).toBe('live');

    binding.dispose();
  });
});

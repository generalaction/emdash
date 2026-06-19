import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileWatchService, FsService, type RawFileEvent } from './index';

async function eventually<T>(
  read: () => T | undefined,
  timeoutMs = 5_000,
  intervalMs = 50
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

describe('FsService', () => {
  it('reads, stats, checks, and removes real files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-shared-fs-'));
    const nested = path.join(root, 'nested');
    const file = path.join(nested, 'note.txt');
    await mkdir(nested);
    await writeFile(file, 'hello shared runtime\n', 'utf8');

    const service = new FsService();
    await expect(service.exists(file)).resolves.toBe(true);

    const stat = await service.stat(file);
    expect(stat).toEqual({
      type: 'file',
      size: Buffer.byteLength('hello shared runtime\n'),
      mtimeMs: expect.any(Number),
    });
    await expect(service.stat(path.join(root, 'missing.txt'))).resolves.toBeNull();

    await expect(service.read(file)).resolves.toMatchObject({
      content: 'hello shared runtime\n',
      truncated: false,
      totalSize: Buffer.byteLength('hello shared runtime\n'),
    });
    await expect(service.read(file, { maxBytes: 5 })).resolves.toMatchObject({
      content: 'hello',
      truncated: true,
      totalSize: Buffer.byteLength('hello shared runtime\n'),
    });

    await service.remove(file);
    await expect(service.exists(file)).resolves.toBe(false);
    await service.remove(nested, { recursive: true });
    await expect(service.exists(nested)).resolves.toBe(false);
  });
});

describe('FileWatchService', () => {
  it('emits real file events through ref-counted leases', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-shared-watch-'));
    const watch = new FileWatchService();
    const firstEvents: RawFileEvent[] = [];
    const secondEvents: RawFileEvent[] = [];

    try {
      const first = watch.watch(root, (events) => firstEvents.push(...events));
      const second = watch.watch(root, (events) => secondEvents.push(...events));
      await Promise.all([first.ready(), second.ready()]);

      const file = path.join(root, 'created.txt');
      await writeFile(file, 'watch me\n', 'utf8');

      await eventually(() =>
        firstEvents.some((event) => path.basename(event.path) === 'created.txt') ? true : undefined
      );
      expect(secondEvents.some((event) => path.basename(event.path) === 'created.txt')).toBe(true);
      const createdEvent = firstEvents.find((event) => path.basename(event.path) === 'created.txt');
      expect(createdEvent).toMatchObject({
        kind: 'create',
        path: expect.any(String),
      });
      expect(path.isAbsolute(createdEvent?.path ?? '')).toBe(true);
      expect(firstEvents[0]).not.toHaveProperty('type');
      expect(firstEvents[0]).not.toHaveProperty('entryType');

      first.release();
      const secondOnlyFile = path.join(root, 'second-only.txt');
      await writeFile(secondOnlyFile, 'still watching\n', 'utf8');
      await eventually(() =>
        secondEvents.some((event) => path.basename(event.path) === 'second-only.txt')
          ? true
          : undefined
      );
      expect(firstEvents.some((event) => path.basename(event.path) === 'second-only.txt')).toBe(
        false
      );

      second.release();
    } finally {
      await watch.dispose();
    }
  });

  it('keeps the shared subscription alive across concurrent release/re-watch', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-shared-watch-relock-'));
    const watch = new FileWatchService();
    const events: RawFileEvent[] = [];

    try {
      const first = watch.watch(root, () => {});
      await first.ready();
      // Release the only consumer and immediately re-watch: the new consumer must wait for
      // the in-flight native teardown and then provision a fresh subscription.
      first.release();
      const second = watch.watch(root, (incoming) => events.push(...incoming));
      await second.ready();

      await writeFile(path.join(root, 'after-rewatch.txt'), 'hi\n', 'utf8');
      await eventually(() =>
        events.some((event) => path.basename(event.path) === 'after-rewatch.txt') ? true : undefined
      );
      second.release();
    } finally {
      await watch.dispose();
    }
  });

  it('surfaces watcher subscription failures through ready()', async () => {
    const root = path.join(tmpdir(), `emdash-shared-watch-missing-${Date.now()}`);
    const watch = new FileWatchService();

    try {
      const handle = watch.watch(root, () => {});

      await expect(handle.ready()).rejects.toThrow();
      handle.release();

      // A failed subscription is evicted: creating the root and re-watching recovers.
      await mkdir(root, { recursive: true });
      const recovered = watch.watch(root, () => {});
      await expect(recovered.ready()).resolves.toBeUndefined();
      recovered.release();
    } finally {
      await watch.dispose();
    }
  });
});

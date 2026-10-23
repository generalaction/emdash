import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Serializable } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJsonFileKeyValueStore } from './index';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

describe('createJsonFileKeyValueStore', () => {
  let directory: string | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('returns the JSON-normalized value after writing', async () => {
    directory = await mkdtemp(join(tmpdir(), 'emdash-json-kv-'));
    const path = join(directory, 'store.json');
    const store = createJsonFileKeyValueStore({ path });
    const value = {
      status: 'active',
      payload: { providerId: 'test', optional: undefined },
    } as unknown as Serializable;

    await expect(store.set('session', value)).resolves.toEqual({ success: true, data: undefined });

    const loaded = await store.get('session');
    expect(loaded).toEqual({
      success: true,
      data: { status: 'active', payload: { providerId: 'test' } },
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(
      loaded.success ? { session: loaded.data } : undefined
    );
  });

  it.each(['set', 'delete'] as const)(
    'does not publish or later flush a failed %s',
    async (operation) => {
      directory = await mkdtemp(join(tmpdir(), 'emdash-json-kv-'));
      const path = join(directory, 'store.json');
      const store = createJsonFileKeyValueStore({ path });
      await store.set('session', 'saved');
      const temporaryPath = `${path}.${process.pid}.tmp`;
      await mkdir(temporaryPath);
      const result =
        operation === 'set'
          ? await store.set('session', 'replacement')
          : await store.delete('session');
      expect(result.success).toBe(false);
      expect(await store.get('session')).toEqual({ success: true, data: 'saved' });
      expect(await store.getAll()).toEqual({ success: true, data: { session: 'saved' } });
      await rm(temporaryPath, { recursive: true });
      await store.set('unrelated', true);
      const reopened = createJsonFileKeyValueStore({ path });
      expect(await reopened.getAll()).toEqual({
        success: true,
        data: { session: 'saved', unrelated: true },
      });
    }
  );

  it('does not publish a rename failure or leak it through another key', async () => {
    directory = await mkdtemp(join(tmpdir(), 'emdash-json-kv-'));
    const path = join(directory, 'store.json');
    const store = createJsonFileKeyValueStore({ path });
    await store.set('session', 'old');
    vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
    expect((await store.set('session', 'new')).success).toBe(false);
    expect(await store.get('session')).toEqual({ success: true, data: 'old' });
    await store.set('other', true);
    expect(await createJsonFileKeyValueStore({ path }).getAll()).toEqual({
      success: true,
      data: { session: 'old', other: true },
    });
  });

  it('keeps a serialization failure out of later writes', async () => {
    directory = await mkdtemp(join(tmpdir(), 'emdash-json-kv-'));
    const path = join(directory, 'store.json');
    const store = createJsonFileKeyValueStore({ path });
    await store.set('session', 'old');
    const circular: Record<string, Serializable> = {};
    circular.self = circular;
    expect((await store.set('session', circular)).success).toBe(false);
    expect((await store.set('other', true)).success).toBe(true);
    expect(await createJsonFileKeyValueStore({ path }).getAll()).toEqual({
      success: true,
      data: { session: 'old', other: true },
    });
  });

  it('exposes committed reads during a pending write and serializes later mutations', async () => {
    directory = await mkdtemp(join(tmpdir(), 'emdash-json-kv-'));
    const path = join(directory, 'store.json');
    const store = createJsonFileKeyValueStore({ path });
    await store.set('session', 'old');
    const entered = deferred<void>();
    const finish = deferred<void>();
    const realWrite = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
      .writeFile;
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered.resolve();
      await finish.promise;
      return realWrite(...args);
    });
    const saving = store.set('session', 'new');
    try {
      await entered.promise;
      const other = store.set('other', true);
      const removing = store.delete('session');
      expect(await store.getAll()).toEqual({ success: true, data: { session: 'old' } });
      finish.resolve();
      expect((await saving).success).toBe(true);
      expect((await other).success).toBe(true);
      expect((await removing).success).toBe(true);
      expect(await createJsonFileKeyValueStore({ path }).getAll()).toEqual({
        success: true,
        data: { other: true },
      });
    } finally {
      finish.resolve();
      await saving;
    }
  });

  it('coalesces initial reads so a late load cannot revert a committed write', async () => {
    directory = await mkdtemp(join(tmpdir(), 'emdash-json-kv-'));
    const path = join(directory, 'store.json');
    await writeFile(path, JSON.stringify({ session: 'old' }));
    const store = createJsonFileKeyValueStore({ path });
    const entered = deferred<void>();
    const finish = deferred<void>();
    const realRead = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
      .readFile;
    vi.mocked(readFile).mockImplementationOnce(async (...args) => {
      const result = await realRead(...args);
      entered.resolve();
      await finish.promise;
      return result;
    });
    const reading = store.get('session');
    let saving: ReturnType<typeof store.set> | undefined;
    try {
      await entered.promise;
      saving = store.set('session', 'new');
      // The write must share the pending load rather than establish another cache.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(readFile).toHaveBeenCalledTimes(1);
      finish.resolve();
      await Promise.all([reading, saving]);
      expect(await store.get('session')).toEqual({ success: true, data: 'new' });
    } finally {
      finish.resolve();
      await Promise.all([reading, saving]);
    }
  });
});

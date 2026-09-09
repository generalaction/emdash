import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Serializable } from '@emdash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonFileKeyValueStore } from './index';

describe('createJsonFileKeyValueStore', () => {
  let directory: string | undefined;

  afterEach(async () => {
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
});

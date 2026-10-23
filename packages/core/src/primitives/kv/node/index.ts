import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ok, type Result, type Serializable } from '@emdash/shared';
import { keyValueIoError, type KeyValueStore, type KeyValueStoreError } from '../api';

export type JsonFileKeyValueStoreOptions = {
  path: string;
};

export function createJsonFileKeyValueStore(options: JsonFileKeyValueStoreOptions): KeyValueStore {
  let loaded: Record<string, Serializable> | null = null;
  let loading: Promise<Result<Record<string, Serializable>, KeyValueStoreError>> | null = null;
  let writeQueue = Promise.resolve();

  function load(): Promise<Result<Record<string, Serializable>, KeyValueStoreError>> {
    if (loaded) return Promise.resolve(ok(loaded));
    loading ??= readState().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readState(): Promise<Result<Record<string, Serializable>, KeyValueStoreError>> {
    try {
      const text = await readFile(options.path, 'utf8');
      const parsed = JSON.parse(text) as Record<string, Serializable>;
      loaded = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      return ok(loaded);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        loaded = {};
        return ok(loaded);
      }
      return { success: false, error: keyValueIoError(error, 'Failed to read KV file') };
    }
  }

  async function flush(
    data: Record<string, Serializable>
  ): Promise<Result<void, KeyValueStoreError>> {
    const tmpPath = `${options.path}.${process.pid}.tmp`;
    try {
      const serialized = JSON.stringify(data, null, 2);
      if (serialized === undefined) {
        throw new TypeError('KV state could not be serialized');
      }
      const normalized = JSON.parse(serialized) as Record<string, Serializable>;
      await mkdir(dirname(options.path), { recursive: true });
      await writeFile(tmpPath, serialized, 'utf8');
      await rename(tmpPath, options.path);
      // Match persistent KV stores: subsequent reads observe the JSON value that was
      // actually written, not pre-serialization properties such as nested `undefined`.
      loaded = normalized;
      return ok();
    } catch (error) {
      return { success: false, error: keyValueIoError(error, 'Failed to write KV file') };
    }
  }

  function enqueueWrite(
    mutator: (candidate: Record<string, Serializable>) => void
  ): Promise<Result<void, KeyValueStoreError>> {
    const run = async () => {
      const state = await load();
      if (!state.success) return state;
      const candidate = { ...state.data };
      mutator(candidate);
      return flush(candidate);
    };
    const result = writeQueue.then(run, run);
    writeQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  return {
    async get(key) {
      const state = await load();
      if (!state.success) return state;
      return ok(state.data[key] ?? null);
    },
    set(key, value) {
      return enqueueWrite((candidate) => {
        candidate[key] = value;
      });
    },
    delete(key) {
      return enqueueWrite((candidate) => {
        delete candidate[key];
      });
    },
    async getAll() {
      const state = await load();
      if (!state.success) return state;
      return ok({ ...state.data });
    },
  };
}

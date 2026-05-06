import { KV } from '@main/db/kv';

const viewStateKV = new KV<Record<string, unknown>>('view-state');

export const viewStateService = {
  save: (key: string, snapshot: unknown): Promise<void> => viewStateKV.set(key, snapshot),

  get: (key: string): Promise<unknown> => viewStateKV.get(key),

  del: (key: string): Promise<void> => viewStateKV.del(key),

  reset: (): Promise<void> => viewStateKV.clear(),
};

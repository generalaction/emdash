import { sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';

const viewStateKV = new KV<Record<string, unknown>>('view-state');

export const viewStateService = {
  save: (key: string, snapshot: unknown): Promise<void> => viewStateKV.set(key, snapshot),

  get: (key: string): Promise<unknown> => viewStateKV.get(key),

  getAll: (): Promise<Record<string, unknown>> =>
    viewStateKV.getAll() as Promise<Record<string, unknown>>,

  del: (key: string): Promise<void> => viewStateKV.del(key),

  reset: (): Promise<void> => viewStateKV.clear(),

  pruneOrphans: (): void => {
    db.run(
      sql`DELETE FROM kv WHERE key LIKE 'view-state:task:%' AND SUBSTR(key, LENGTH('view-state:task:') + 1) NOT IN (SELECT id FROM tasks)`
    );
    db.run(
      sql`DELETE FROM kv WHERE key LIKE 'view-state:project:%' AND SUBSTR(key, LENGTH('view-state:project:') + 1) NOT IN (SELECT id FROM projects)`
    );
  },
};

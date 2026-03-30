import { appendFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { kv } from './schema';

// #region agent log
const _dbgLog = (obj: object) => {
  try {
    appendFileSync(
      '/Users/davidkonopka/Documents/emdash/.cursor/debug-f1d8e3.log',
      JSON.stringify({ sessionId: 'f1d8e3', ...obj, timestamp: Date.now(), runId: 'run5' }) + '\n'
    );
  } catch {}
};
// #endregion

export class KV<TSchema extends Record<string, unknown>> {
  constructor(private readonly namespace: string) {}

  private prefixed(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<K extends keyof TSchema & string>(key: K): Promise<TSchema[K] | null> {
    const rows = await db
      .select({ value: kv.value })
      .from(kv)
      .where(eq(kv.key, this.prefixed(key)))
      .limit(1);

    const raw = rows[0]?.value;
    // #region agent log
    _dbgLog({
      location: 'kv.ts:get-result',
      message: 'KV.get result',
      hypothesisId: 'H',
      data: {
        key: this.prefixed(key),
        found: raw !== undefined && raw !== null,
        rawLen: raw?.length,
      },
    });
    // #endregion
    if (raw === undefined || raw === null) return null;

    try {
      return JSON.parse(raw) as TSchema[K];
    } catch {
      return null;
    }
  }

  async set<K extends keyof TSchema & string>(key: K, value: TSchema[K]): Promise<void> {
    try {
      const serialised = JSON.stringify(value);
      const now = Date.now();
      // #region agent log
      _dbgLog({
        location: 'kv.ts:set-before',
        message: 'KV.set attempting insert',
        hypothesisId: 'H',
        data: { key: this.prefixed(key) },
      });
      // #endregion
      await db
        .insert(kv)
        .values({ key: this.prefixed(key), value: serialised, updatedAt: now })
        .onConflictDoUpdate({ target: kv.key, set: { value: serialised, updatedAt: now } });
      // #region agent log
      _dbgLog({
        location: 'kv.ts:set-after',
        message: 'KV.set insert succeeded',
        hypothesisId: 'H',
        data: { key: this.prefixed(key) },
      });
      // #endregion
    } catch (e) {
      // #region agent log
      _dbgLog({
        location: 'kv.ts:set-catch',
        message: 'KV.set insert FAILED',
        hypothesisId: 'H',
        data: { key: this.prefixed(key), error: String(e) },
      });
      // #endregion
      // kv table may not exist yet during the first-run migration window
    }
  }

  async del<K extends keyof TSchema & string>(key: K): Promise<void> {
    try {
      await db.delete(kv).where(eq(kv.key, this.prefixed(key)));
    } catch {
      // kv table may not exist yet during the first-run migration window
    }
  }
}

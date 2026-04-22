import { eq, like } from 'drizzle-orm';
import { db } from './client';
import { kv } from './schema';

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

      await db
        .insert(kv)
        .values({ key: this.prefixed(key), value: serialised, updatedAt: now })
        .onConflictDoUpdate({ target: kv.key, set: { value: serialised, updatedAt: now } });
    } catch (e) {
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

  async clear(): Promise<void> {
    try {
      await db.delete(kv).where(like(kv.key, `${this.namespace}:%`));
    } catch {
      // kv table may not exist yet during the first-run migration window
    }
  }
}

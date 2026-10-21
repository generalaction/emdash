import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from '@core/services/app-db/node/db';
import { kv } from '@core/services/app-db/node/schema';
import type {
  ProviderAccountSecretStore,
  ProviderAccountStore,
} from '../../api/provider-account-store';
import { writeProviderAccount } from '../write-provider-account';

type ImportOutcome = 'complete' | 'cleanup' | 'retry';
type ImportState = { cleanupPending: boolean };
const importState = z.object({ cleanupPending: z.boolean() });

/** Migration-only owner of durable import completion and retryable source cleanup. */
export class LegacyAccountImports {
  private readonly pending = new Map<string, Promise<'complete' | 'retry'>>();
  private readonly completed = new Set<string>();

  constructor(
    private readonly db: AppDb,
    private readonly secrets: Pick<ProviderAccountSecretStore, 'setSecret'>,
    private readonly logger: { warn(message: string, context: Record<string, unknown>): void }
  ) {}

  run(
    key: string,
    importAccount: (store: Pick<ProviderAccountStore, 'upsertAccount'>) => Promise<ImportOutcome>,
    cleanup: () => Promise<void>
  ): Promise<'complete' | 'retry'> {
    if (this.completed.has(key)) return Promise.resolve('complete');
    const pending = this.pending.get(key);
    if (pending) return pending;
    const next = this.importAndClean(key, importAccount, cleanup).finally(() =>
      this.pending.delete(key)
    );
    this.pending.set(key, next);
    return next;
  }

  private async importAndClean(
    key: string,
    importAccount: (store: Pick<ProviderAccountStore, 'upsertAccount'>) => Promise<ImportOutcome>,
    cleanup: () => Promise<void>
  ): Promise<'complete' | 'retry'> {
    // Failed reads and malformed markers must never authorize another import.
    const row = this.db.select().from(kv).where(eq(kv.key, key)).get();
    let state: ImportState;
    if (row) {
      const value: unknown = JSON.parse(row.value);
      // Released GitHub imports recorded a completedAt timestamp under this key.
      state =
        key === 'github-legacy-token-import:completedAt' &&
        typeof value === 'number' &&
        Number.isFinite(value)
          ? { cleanupPending: false }
          : importState.parse(value);
    } else {
      let imported = false;
      const outcome = await importAccount({
        upsertAccount: async (input) => {
          const result = await writeProviderAccount(this.db, this.secrets, input, (tx) => {
            tx.insert(kv)
              .values({
                key,
                value: JSON.stringify({ cleanupPending: true }),
                updatedAt: Date.now(),
              })
              .run();
          });
          imported = true;
          return result;
        },
      });
      if (outcome === 'retry') return 'retry';
      state = { cleanupPending: outcome === 'cleanup' };
      if (!imported) {
        this.db
          .insert(kv)
          .values({ key, value: JSON.stringify(state), updatedAt: Date.now() })
          .run();
      }
    }

    if (state.cleanupPending) {
      try {
        await cleanup();
        this.db
          .update(kv)
          .set({ value: JSON.stringify({ cleanupPending: false }), updatedAt: Date.now() })
          .where(eq(kv.key, key))
          .run();
      } catch (error) {
        this.logger.warn('Failed to clean up imported account credentials; will retry', {
          key,
          error,
        });
        return 'retry';
      }
    }
    this.completed.add(key);
    return 'complete';
  }
}

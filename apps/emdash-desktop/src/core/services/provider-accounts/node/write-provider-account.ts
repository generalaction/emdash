import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ProviderAccountMeta } from '@core/primitives/provider-accounts/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { providerAccounts, type ProviderAccountRow } from '@core/services/app-db/node/schema';
import type {
  ProviderAccountSecretStore,
  ProviderAccountUpsert,
} from '../api/provider-account-store';
import { ensureProviderAccountDisplayNames } from './account-display-names';

/** Shared persistence for registry writes and imports with an atomic completion record. */
export async function writeProviderAccount(
  db: AppDb,
  secrets: Pick<ProviderAccountSecretStore, 'setSecret'>,
  input: ProviderAccountUpsert,
  onPersist?: (tx: DrizzleTx) => void
): Promise<{ account: ProviderAccountRow; status: 'created' | 'updated' }> {
  const where = and(
    eq(providerAccounts.providerId, input.providerId),
    eq(providerAccounts.accountId, input.accountId)
  );
  const existing = db.select().from(providerAccounts).where(where).get();
  const credentialRef =
    existing?.credentialRef ??
    input.credentialRef ??
    `provider-credential:${input.providerId}:${input.accountId}`;
  // Secret I/O finishes before the synchronous DB transaction. A failed commit
  // leaves the legacy source intact so the import can retry safely.
  if (input.secret !== undefined) await secrets.setSecret(credentialRef, input.secret);
  const meta: ProviderAccountMeta | undefined =
    input.meta === undefined ? undefined : { version: '1', ...input.meta };
  return db.transaction((tx) => {
    const now = Date.now();
    const current = tx.select().from(providerAccounts).where(where).get();
    let account: ProviderAccountRow;
    if (current) {
      // Generated names belong to the saved connection, not the latest verifier response.
      const nextMeta =
        meta === undefined
          ? current.meta
          : {
              ...meta,
              ...(current.meta?.fallbackDisplayName
                ? { fallbackDisplayName: current.meta.fallbackDisplayName }
                : {}),
            };
      tx.update(providerAccounts)
        .set({ updatedAt: now, meta: nextMeta })
        .where(eq(providerAccounts.id, current.id))
        .run();
      account = { ...current, updatedAt: now, meta: nextMeta };
    } else {
      const hasDefault = tx
        .select({ id: providerAccounts.id })
        .from(providerAccounts)
        .where(
          and(
            eq(providerAccounts.providerId, input.providerId),
            eq(providerAccounts.isDefault, true)
          )
        )
        .get();
      account = {
        id: randomUUID(),
        providerId: input.providerId,
        accountId: input.accountId,
        credentialRef,
        isDefault: !hasDefault,
        meta: meta ?? null,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(providerAccounts).values(account).run();
    }
    account =
      ensureProviderAccountDisplayNames(tx, input.providerId).find(
        (row) => row.id === account.id
      ) ?? account;
    onPersist?.(tx);
    return { account, status: current ? 'updated' : 'created' };
  });
}

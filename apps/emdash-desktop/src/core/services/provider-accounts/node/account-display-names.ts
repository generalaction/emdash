import { asc, eq, sql } from 'drizzle-orm';
import type { DrizzleTx } from '@core/services/app-db/node/db';
import { providerAccounts } from '@core/services/app-db/node/schema';

/** Assign missing names atomically; inventory ordering and default changes never rename accounts. */
export function ensureProviderAccountDisplayNames(tx: DrizzleTx, providerId: string) {
  const rows = tx
    .select()
    .from(providerAccounts)
    .where(eq(providerAccounts.providerId, providerId))
    .orderBy(asc(providerAccounts.createdAt), asc(sql`rowid`))
    .all();
  const usedNames = new Set(
    rows.flatMap(({ meta }) =>
      [meta?.label, meta?.displayName, meta?.fallbackDisplayName]
        .map((name) => name?.trim())
        .filter(Boolean)
    )
  );
  let nextNumber = 1;
  return rows.map((row) => {
    const meta = row.meta;
    if (
      meta?.label?.trim() ||
      meta?.displayName?.trim() ||
      meta?.login?.trim() ||
      meta?.fallbackDisplayName?.trim()
    ) {
      return row;
    }
    while (usedNames.has(`Account ${nextNumber}`)) nextNumber++;
    const fallbackDisplayName = `Account ${nextNumber++}`;
    usedNames.add(fallbackDisplayName);
    const namedMeta = { ...meta, version: '1' as const, fallbackDisplayName };
    tx.update(providerAccounts)
      .set({ meta: namedMeta })
      .where(eq(providerAccounts.id, row.id))
      .run();
    return { ...row, meta: namedMeta };
  });
}

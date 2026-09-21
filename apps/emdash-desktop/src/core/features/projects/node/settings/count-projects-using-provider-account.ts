import type { AppDb } from '@core/services/app-db/node/db';
import { projectSettings as projectSettingsTable } from '@core/services/app-db/node/schema';
import { readStoredProjectSettings } from './migrations/stored-settings';

/**
 * The account a row explicitly pins for one provider. Reads the current
 * `integrationAccounts` map first; for GitHub, rows not yet lazily migrated
 * are normalized by the same migration reader as execution and settings.
 */
function readPinnedProviderAccountId(raw: string, providerId: string): string | undefined {
  try {
    const choice = readStoredProjectSettings(raw).integrationAccounts?.[providerId];
    return choice?.kind === 'account' ? choice.accountId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Projects explicitly pinned to one provider account, for the
 * account-removal confirmation. Projects on the inferred default are not
 * counted — they follow whatever account becomes the default next.
 */
export async function countProjectsUsingProviderAccount(
  db: AppDb,
  providerId: string,
  accountId: string
): Promise<number> {
  const targetAccountId = accountId.trim();
  if (!targetAccountId || !providerId.trim()) return 0;

  const rows = db
    .select({ baseProjectSettingsJson: projectSettingsTable.baseProjectSettingsJson })
    .from(projectSettingsTable)
    .all();

  let count = 0;
  for (const row of rows) {
    if (readPinnedProviderAccountId(row.baseProjectSettingsJson, providerId) === targetAccountId) {
      count += 1;
    }
  }
  return count;
}

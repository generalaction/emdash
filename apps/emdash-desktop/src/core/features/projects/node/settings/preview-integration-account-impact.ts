import { sql } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  projects as projectsTable,
  projectSettings as projectSettingsTable,
} from '@core/services/app-db/node/schema';
import { parseJsonObject } from './project-settings-json';

export type IntegrationAccountImpact = {
  /** Whether the account is the integration's current default. */
  isDefault: boolean;
  /** Projects that explicitly pin this account (they fail closed until repinned). */
  pinnedCount: number;
  /**
   * Projects with no explicit choice for this integration (they resolve to the
   * default). Only relevant when removing/replacing the default account.
   */
  defaultFollowerCount: number;
};

type IntegrationChoice = 'pinned-to-target' | 'explicit-other' | 'none';

function classifyRow(
  raw: string,
  integrationId: string,
  targetAccountId: string
): IntegrationChoice {
  try {
    const parsed = parseJsonObject(raw) as Record<string, unknown>;
    const map = parsed.issueTrackerAccounts;
    if (!map || typeof map !== 'object') return 'none';
    const entry = (map as Record<string, unknown>)[integrationId];
    if (!entry || typeof entry !== 'object') return 'none';
    const { kind, accountId } = entry as Record<string, unknown>;
    if (kind === 'account' && typeof accountId === 'string') {
      return accountId === targetAccountId ? 'pinned-to-target' : 'explicit-other';
    }
    if (kind === 'none') return 'explicit-other';
    return 'none';
  } catch {
    return 'none';
  }
}

export async function previewIntegrationAccountImpact(
  db: AppDb,
  deps: { getDefaultAccountId(integrationId: string): Promise<string | null> },
  input: { integrationId: string; accountId: string }
): Promise<IntegrationAccountImpact> {
  const targetAccountId = input.accountId.trim();
  const empty: IntegrationAccountImpact = {
    isDefault: false,
    pinnedCount: 0,
    defaultFollowerCount: 0,
  };
  if (!targetAccountId) return empty;

  const isDefault = (await deps.getDefaultAccountId(input.integrationId)) === targetAccountId;

  const settingsRows = db
    .select({ baseProjectSettingsJson: projectSettingsTable.baseProjectSettingsJson })
    .from(projectSettingsTable)
    .all();
  const [{ total }] = db
    .select({ total: sql<number>`count(*)` })
    .from(projectsTable)
    .all();

  let pinnedCount = 0;
  let explicitChoiceCount = 0;
  for (const row of settingsRows) {
    const choice = classifyRow(row.baseProjectSettingsJson, input.integrationId, targetAccountId);
    if (choice === 'pinned-to-target') {
      pinnedCount += 1;
      explicitChoiceCount += 1;
    } else if (choice === 'explicit-other') {
      explicitChoiceCount += 1;
    }
  }

  // Projects with no explicit choice (including those with no settings row) all
  // resolve to the default, so removing/replacing the default re-points them.
  const defaultFollowerCount = isDefault ? Math.max(0, total - explicitChoiceCount) : 0;

  return { isDefault, pinnedCount, defaultFollowerCount };
}

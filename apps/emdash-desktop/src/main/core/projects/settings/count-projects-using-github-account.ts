import { db } from '@main/db/client';
import { projectSettings as projectSettingsTable } from '@main/db/schema';
import { parseJsonObject } from './project-settings-json';

function readPinnedGithubAccountId(raw: string): string | undefined {
  try {
    const parsed = parseJsonObject(raw) as Record<string, unknown>;
    const value = parsed.githubAccountId;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export async function countProjectsUsingGithubAccount(accountId: string): Promise<number> {
  const targetAccountId = accountId.trim();
  if (!targetAccountId) return 0;

  const rows = db
    .select({ baseProjectSettingsJson: projectSettingsTable.baseProjectSettingsJson })
    .from(projectSettingsTable)
    .all();

  let count = 0;
  for (const row of rows) {
    if (readPinnedGithubAccountId(row.baseProjectSettingsJson) === targetAccountId) {
      count += 1;
    }
  }
  return count;
}

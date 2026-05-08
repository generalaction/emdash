import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projectSettings as projectSettingsTable } from '@main/db/schema';

export type StoredProjectSettings = {
  baseProjectSettingsJson: string;
  shareableProjectSettingsJson: string;
  legacyConfigMigratedAt: string | null;
};

export interface ProjectSettingsStorage {
  get(projectId: string): Promise<StoredProjectSettings | undefined>;
  insert(projectId: string, settings: StoredProjectSettings): Promise<void>;
  update(projectId: string, settings: Partial<StoredProjectSettings>): Promise<void>;
}

export class ProjectSettingsRepository implements ProjectSettingsStorage {
  async get(projectId: string): Promise<StoredProjectSettings | undefined> {
    const row = db
      .select()
      .from(projectSettingsTable)
      .where(eq(projectSettingsTable.projectId, projectId))
      .get();
    if (!row) return undefined;
    return {
      baseProjectSettingsJson: row.baseProjectSettingsJson,
      shareableProjectSettingsJson: row.shareableProjectSettingsJson,
      legacyConfigMigratedAt: row.legacyConfigMigratedAt,
    };
  }

  async insert(projectId: string, settings: StoredProjectSettings): Promise<void> {
    await db.insert(projectSettingsTable).values({
      projectId,
      baseProjectSettingsJson: settings.baseProjectSettingsJson,
      shareableProjectSettingsJson: settings.shareableProjectSettingsJson,
      legacyConfigMigratedAt: settings.legacyConfigMigratedAt,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    });
  }

  async update(projectId: string, settings: Partial<StoredProjectSettings>): Promise<void> {
    await db
      .update(projectSettingsTable)
      .set({
        ...settings,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(projectSettingsTable.projectId, projectId));
  }
}

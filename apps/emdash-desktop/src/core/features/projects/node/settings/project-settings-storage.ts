import { eq, sql } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { projectSettings as projectSettingsTable } from '@core/services/app-db/node/schema';

export type StoredProjectSettings = {
  baseProjectSettingsJson: string;
  shareableProjectSettingsJson: string;
  legacyConfigMigratedAt: string | null;
};

export interface ProjectSettingsStorage {
  get(projectId: string): Promise<StoredProjectSettings | undefined>;
  insertIfMissing(projectId: string, settings: StoredProjectSettings): Promise<void>;
  mutate(
    projectId: string,
    change: (current: StoredProjectSettings) => Partial<StoredProjectSettings>
  ): Promise<StoredProjectSettings>;
}

export class ProjectSettingsRepository implements ProjectSettingsStorage {
  constructor(private readonly db: AppDb) {}

  async get(projectId: string): Promise<StoredProjectSettings | undefined> {
    const row = this.db
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

  async insertIfMissing(projectId: string, settings: StoredProjectSettings): Promise<void> {
    await this.db
      .insert(projectSettingsTable)
      .values({
        projectId,
        baseProjectSettingsJson: settings.baseProjectSettingsJson,
        shareableProjectSettingsJson: settings.shareableProjectSettingsJson,
        legacyConfigMigratedAt: settings.legacyConfigMigratedAt,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoNothing();
  }

  async mutate(
    projectId: string,
    change: (current: StoredProjectSettings) => Partial<StoredProjectSettings>
  ): Promise<StoredProjectSettings> {
    return this.db.transaction((tx) => {
      const current = tx
        .select()
        .from(projectSettingsTable)
        .where(eq(projectSettingsTable.projectId, projectId))
        .get();
      if (!current) throw new Error(`Project settings not found: ${projectId}`);
      const patch = change(current);
      if (Object.keys(patch).length > 0) {
        tx.update(projectSettingsTable)
          .set({ ...patch, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(projectSettingsTable.projectId, projectId))
          .run();
      }
      return { ...current, ...patch };
    });
  }
}

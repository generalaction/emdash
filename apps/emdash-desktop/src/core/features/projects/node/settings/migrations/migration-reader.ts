import type { LegacyLifecycleSettings } from './legacy-stored-project-settings';

/**
 * Narrow adapter over DB provider internals needed only while desktop-owned
 * settings are migrated at project mount.
 */
export type ProjectSettingsMigrationReader = {
  migrateAncientConfig(): Promise<void>;
  readLegacyLifecycleSettings(): Promise<LegacyLifecycleSettings>;
  finalizeLegacyLifecycleSettings(): Promise<void>;
};

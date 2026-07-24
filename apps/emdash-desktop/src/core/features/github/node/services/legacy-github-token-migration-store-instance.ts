import type { LegacyGitHubTokenMigrationStore } from './legacy-github-token-migration-store';

let legacyGitHubTokenMigrationStore: LegacyGitHubTokenMigrationStore | undefined;

export function setLegacyGitHubTokenMigrationStore(store: LegacyGitHubTokenMigrationStore): void {
  legacyGitHubTokenMigrationStore = store;
}

export function getLegacyGitHubTokenMigrationStore(): LegacyGitHubTokenMigrationStore {
  if (!legacyGitHubTokenMigrationStore) {
    throw new Error('Legacy GitHub token migration store has not been configured');
  }
  return legacyGitHubTokenMigrationStore;
}

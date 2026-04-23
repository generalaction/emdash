import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { StartupDataGateStatus } from '@shared/startup-data-gate';
import { log } from '../../lib/logger';
import * as schema from '../schema';
import { portLegacyAuthState } from './importers/auth/importer';
import { portConversations } from './importers/relational/conversations';
import { portProjects } from './importers/relational/projects';
import { createRemapTables } from './importers/relational/remap';
import { portSshConnections } from './importers/relational/ssh-connections';
import { portTasks } from './importers/relational/tasks';
import type { PortSummary } from './importers/relational/types';
import { portLegacySettings } from './importers/settings/importer';
import { openLegacyReadOnly } from './legacy-source/open-readonly';
import { hasLegacyDatabaseFile, resolveLegacyDatabasePath } from './legacy-source/path';
import { createLegacyPortStateStore } from './state-store';

type LegacyPortDb = ReturnType<typeof drizzle<typeof schema>>;

type AppTarget = {
  db: LegacyPortDb;
  sqlite: Database.Database;
};

export type LegacyPortStatus = StartupDataGateStatus;

export interface LegacyPortStateStore {
  getStatus(): Promise<LegacyPortStatus | null>;
  setStatus(status: LegacyPortStatus): Promise<void>;
}

export type RunLegacyPortOptions = {
  appDb?: Database.Database;
  stateStore?: LegacyPortStateStore;
};

async function resolveAppTarget(appSqlite?: Database.Database): Promise<AppTarget> {
  if (!appSqlite) {
    const { db, sqlite } = await import('../client');
    return { db, sqlite };
  }

  return {
    db: drizzle(appSqlite, { schema }),
    sqlite: appSqlite,
  };
}

function logSummary(summary: PortSummary): void {
  log.info(
    `legacy-port: ${summary.table}: considered=${summary.considered}, inserted=${summary.inserted}, skipped_dedup=${summary.skippedDedup}, skipped_invalid=${summary.skippedInvalid}, skipped_error=${summary.skippedError}`
  );
}

async function markStatus(
  stateStore: LegacyPortStateStore,
  status: 'completed' | 'no-legacy-file'
): Promise<void> {
  try {
    await stateStore.setStatus(status);
  } catch (error) {
    log.warn('legacy-port: failed to persist status', {
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createDefaultLegacyPortStateStore(): Promise<LegacyPortStateStore> {
  return createLegacyPortStateStore();
}

export function resolveLegacyPath(userDataPath: string): string {
  return resolveLegacyDatabasePath(userDataPath);
}

export function hasLegacyFile(userDataPath: string): boolean {
  return hasLegacyDatabaseFile(userDataPath);
}

export async function runLegacyPort(
  userDataPath: string,
  options: RunLegacyPortOptions = {}
): Promise<void> {
  const appTarget = await resolveAppTarget(options.appDb);
  const stateStore = options.stateStore ?? (await createDefaultLegacyPortStateStore());

  try {
    const status = await stateStore.getStatus();
    if (status) {
      return;
    }
  } catch (error) {
    log.warn('legacy-port: failed to read status, continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!hasLegacyFile(userDataPath)) {
    log.info('legacy-port: no legacy emdash.db found, marking complete');
    await markStatus(stateStore, 'no-legacy-file');
    return;
  }

  const legacyPath = resolveLegacyPath(userDataPath);
  let legacyDb: Database.Database;

  try {
    legacyDb = openLegacyReadOnly(legacyPath);
  } catch (error) {
    log.warn('legacy-port: failed to open legacy db, will retry next launch', {
      legacyPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const start = Date.now();

  try {
    const remap = createRemapTables();

    const sshSummary = await portSshConnections({ appDb: appTarget.db, legacyDb, remap });
    const projectsSummary = await portProjects({ appDb: appTarget.db, legacyDb, remap });
    const taskResult = await portTasks({ appDb: appTarget.db, legacyDb, remap });
    const conversationsSummary = await portConversations({
      appDb: appTarget.db,
      legacyDb,
      remap,
      mergedLegacyTaskIds: taskResult.mergedLegacyTaskIds,
      userDataPath,
    });

    logSummary(sshSummary);
    logSummary(projectsSummary);
    logSummary(taskResult.summary);
    logSummary(conversationsSummary);

    try {
      const authSummary = await portLegacyAuthState(userDataPath, {
        appDb: appTarget.db,
        appSqlite: appTarget.sqlite,
        legacyToAppSshConnectionId: remap.sshConnectionId,
      });
      log.info(
        `legacy-port: auth: imported_secrets=${authSummary.importedSecrets.length}, imported_kv=${authSummary.importedKv.length}, imported_ssh_passwords=${authSummary.importedSshPasswords}, skipped=${authSummary.skipped.length}`
      );
    } catch (error) {
      log.warn('legacy-port: auth: failed to port legacy credentials, continuing', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const settingsSummary = await portLegacySettings(userDataPath, {
        appDb: appTarget.db,
        appSqlite: appTarget.sqlite,
      });
      log.info(
        `legacy-port: settings: imported=${settingsSummary.imported.length}, skipped=${settingsSummary.skipped.length}`
      );
    } catch (error) {
      log.warn('legacy-port: settings: failed to port legacy settings, continuing', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await markStatus(stateStore, 'completed');

    log.info(`legacy-port: completed in ${Date.now() - start}ms`);
  } catch (error) {
    log.warn('legacy-port: aborted mid-run, will retry next launch', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    legacyDb.close();
  }
}

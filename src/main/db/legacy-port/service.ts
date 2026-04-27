import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { LegacyImportSource } from '@shared/legacy-port';
import type { StartupDataGateStatus } from '@shared/startup-data-gate';
import { log } from '../../lib/logger';
import * as schema from '../schema';
import { importBetaDatabaseIntoDestination } from './beta-import';
import { deleteProjectsById } from './destination-cleanup';
import { portConversations } from './importers/relational/conversations';
import { portProjects } from './importers/relational/projects';
import { createRemapTables } from './importers/relational/remap';
import { portSshConnections } from './importers/relational/ssh-connections';
import { portTasks } from './importers/relational/tasks';
import type { PortSummary } from './importers/relational/types';
import { portLegacySettings } from './importers/settings/importer';
import { openLegacyReadOnly } from './legacy-source/open-readonly';
import {
  hasBetaDatabaseFile,
  hasLegacyDatabaseFile,
  resolveBetaDatabasePath,
  resolveLegacyDatabasePath,
} from './legacy-source/path';
import { clearDestinationDataPreservingSignIn } from './reset';
import { buildLegacyProjectSelection } from './source-analysis';
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
  sources?: LegacyImportSource[];
  conflictChoices?: Record<string, LegacyImportSource>;
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
  status: LegacyPortStatus
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

async function withAtomicDestinationImport<T>(
  sqlite: Database.Database,
  action: () => Promise<T>
): Promise<T> {
  const foreignKeys = sqlite.pragma('foreign_keys', { simple: true }) as number;
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec('BEGIN IMMEDIATE');

  try {
    const result = await action();
    sqlite.exec('COMMIT');
    return result;
  } catch (error) {
    if (sqlite.inTransaction) {
      sqlite.exec('ROLLBACK');
    }
    throw error;
  } finally {
    sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

export async function createDefaultLegacyPortStateStore(): Promise<LegacyPortStateStore> {
  return createLegacyPortStateStore();
}

export async function runLegacyPort(
  userDataPath: string,
  options: RunLegacyPortOptions = {}
): Promise<void> {
  const appTarget = await resolveAppTarget(options.appDb);
  const stateStore = options.stateStore ?? (await createDefaultLegacyPortStateStore());
  const selectedSources = new Set<LegacyImportSource>(options.sources ?? ['v0']);

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

  if (selectedSources.size === 0) {
    clearDestinationDataPreservingSignIn(appTarget.sqlite);
    await markStatus(stateStore, 'wiped-beta');
    return;
  }

  if (selectedSources.has('v1-beta')) {
    const betaPath = resolveBetaDatabasePath(userDataPath);
    if (hasBetaDatabaseFile(userDataPath)) {
      importBetaDatabaseIntoDestination(appTarget.sqlite, betaPath);
    } else {
      log.warn('legacy-port: v1-beta source selected but emdash3.db was not found', { betaPath });
    }
  }

  if (!selectedSources.has('v0')) {
    await markStatus(stateStore, selectedSources.has('v1-beta') ? 'kept-beta' : 'skipped-legacy');
    return;
  }

  if (!hasLegacyDatabaseFile(userDataPath)) {
    log.info('legacy-port: no legacy emdash.db found, marking complete');
    await markStatus(stateStore, 'no-legacy-file');
    return;
  }

  const legacyPath = resolveLegacyDatabasePath(userDataPath);
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
    const { sshSummary, projectsSummary, taskResult, conversationsSummary } =
      await withAtomicDestinationImport(appTarget.sqlite, async () => {
        const remap = createRemapTables();
        if (!selectedSources.has('v1-beta')) {
          clearDestinationDataPreservingSignIn(appTarget.sqlite);
        }

        const selection = await buildLegacyProjectSelection({
          appDb: appTarget.db,
          legacyDb,
          selectedSources,
          conflictChoices: options.conflictChoices ?? {},
        });

        if (selectedSources.has('v1-beta')) {
          deleteProjectsById(appTarget.sqlite, selection.replaceAppProjectIds);
        }

        const sshSummary = await portSshConnections({
          appDb: appTarget.db,
          legacyDb,
          remap,
          allowedLegacyConnectionIds: selection.allowedLegacySshConnectionIds,
        });
        const projectsSummary = await portProjects({
          appDb: appTarget.db,
          legacyDb,
          remap,
          skipLegacyProjectIds: selection.skipLegacyProjectIds,
        });
        const taskResult = await portTasks({ appDb: appTarget.db, legacyDb, remap });
        const conversationsSummary = await portConversations({
          appDb: appTarget.db,
          legacyDb,
          remap,
          mergedLegacyTaskIds: taskResult.mergedLegacyTaskIds,
          userDataPath,
        });

        return { sshSummary, projectsSummary, taskResult, conversationsSummary };
      });

    logSummary(sshSummary);
    logSummary(projectsSummary);
    logSummary(taskResult.summary);
    logSummary(conversationsSummary);

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

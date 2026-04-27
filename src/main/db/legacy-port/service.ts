import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { StartupDataGateStatus } from '@shared/startup-data-gate';
import { log } from '../../lib/logger';
import * as schema from '../schema';
import { importBetaDatabaseIntoDestination } from './beta-import';
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
export type LegacyImportSource = 'v0' | 'v1-beta';

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

function deleteProjectsById(sqlite: Database.Database, projectIds: ReadonlySet<string>): void {
  if (projectIds.size === 0) return;

  const ids = [...projectIds];
  const placeholders = ids.map(() => '?').join(', ');
  const tableExists = (tableName: string): boolean =>
    Boolean(
      sqlite
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
        .get(tableName)
    );

  const taskRows = tableExists('tasks')
    ? (sqlite
        .prepare(`SELECT id FROM tasks WHERE project_id IN (${placeholders})`)
        .all(...ids) as Array<{ id: string }>)
    : [];
  const taskIds = taskRows.map((row) => row.id);
  const taskPlaceholders = taskIds.map(() => '?').join(', ');

  if (tableExists('messages') && tableExists('conversations')) {
    sqlite
      .prepare(
        `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id IN (${placeholders}))`
      )
      .run(...ids);
  }

  if (tableExists('conversations')) {
    sqlite.prepare(`DELETE FROM conversations WHERE project_id IN (${placeholders})`).run(...ids);
  }

  if (tableExists('terminals')) {
    sqlite.prepare(`DELETE FROM terminals WHERE project_id IN (${placeholders})`).run(...ids);
  }

  if (tableExists('editor_buffers')) {
    sqlite.prepare(`DELETE FROM editor_buffers WHERE project_id IN (${placeholders})`).run(...ids);
  }

  if (tableExists('project_remotes')) {
    sqlite.prepare(`DELETE FROM project_remotes WHERE project_id IN (${placeholders})`).run(...ids);
  }

  if (taskIds.length > 0 && tableExists('tasks_pull_requests')) {
    sqlite
      .prepare(`DELETE FROM tasks_pull_requests WHERE task_id IN (${taskPlaceholders})`)
      .run(...taskIds);
  }

  if (tableExists('projects_pull_requests')) {
    sqlite
      .prepare(`DELETE FROM projects_pull_requests WHERE project_id IN (${placeholders})`)
      .run(...ids);
  }

  if (tableExists('tasks')) {
    sqlite.prepare(`DELETE FROM tasks WHERE project_id IN (${placeholders})`).run(...ids);
  }

  if (tableExists('projects')) {
    sqlite.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...ids);
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

import type Database from 'better-sqlite3';
import { log } from '../../lib/logger';
import { openLegacyReadOnly } from './open-legacy';
import { portLegacyAuthState } from './port-legacy-auth';
import { portConversations } from './ports/conversations';
import { portProjects } from './ports/projects';
import { portSshConnections } from './ports/ssh-connections';
import { portTasks } from './ports/tasks';
import type { PortSummary } from './ports/types';
import { createRemapTables } from './remap';
import {
  createDefaultLegacyPortStateStore,
  hasLegacyFile,
  resolveLegacyPath,
  type LegacyPortStateStore,
} from './should-run';

export type RunLegacyPortOptions = {
  appDb?: Database.Database;
  stateStore?: LegacyPortStateStore;
};

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

export async function runLegacyPort(
  userDataPath: string,
  options: RunLegacyPortOptions = {}
): Promise<void> {
  const appDb = options.appDb ?? (await import('../client')).sqlite;
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

    const sshSummary = portSshConnections({ appDb, legacyDb, remap });
    const projectsSummary = portProjects({ appDb, legacyDb, remap });
    const taskResult = portTasks({ appDb, legacyDb, remap });
    const conversationsSummary = portConversations({
      appDb,
      legacyDb,
      remap,
      mergedLegacyTaskIds: taskResult.mergedLegacyTaskIds,
    });

    logSummary(sshSummary);
    logSummary(projectsSummary);
    logSummary(taskResult.summary);
    logSummary(conversationsSummary);

    try {
      const authSummary = await portLegacyAuthState(userDataPath, { appDb });
      log.info(
        `legacy-port: auth: imported_secrets=${authSummary.importedSecrets.length}, imported_kv=${authSummary.importedKv.length}, skipped=${authSummary.skipped.length}`
      );
    } catch (error) {
      log.warn('legacy-port: auth: failed to port legacy credentials, continuing', {
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

import { count } from 'drizzle-orm';
import { app } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import { db } from '@main/db/client';
import { projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { legacyTableExists } from './importers/relational/helpers';
import { openLegacyReadOnly } from './legacy-source/open-readonly';
import { hasLegacyDatabaseFile, resolveLegacyDatabasePath } from './legacy-source/path';
import { createDefaultLegacyPortStateStore, runLegacyPort } from './service';

export const legacyPortController = createRPCController({
  checkStatus: async () => {
    const userDataPath = app.getPath('userData');
    const hasLegacyDb = hasLegacyDatabaseFile(userDataPath);
    const stateStore = await createDefaultLegacyPortStateStore();
    const portStatus = await stateStore.getStatus();
    const [{ value: projectCount }] = await db.select({ value: count() }).from(projects);
    const [{ value: taskCount }] = await db.select({ value: count() }).from(tasks);
    const hasExistingData = projectCount > 0 || taskCount > 0;
    return { hasLegacyDb, portStatus: portStatus ?? null, hasExistingData };
  },

  getPreview: async () => {
    const userDataPath = app.getPath('userData');
    if (!hasLegacyDatabaseFile(userDataPath)) {
      return { projects: 0, tasks: 0 };
    }
    const legacyPath = resolveLegacyDatabasePath(userDataPath);
    let legacyDb;
    try {
      legacyDb = openLegacyReadOnly(legacyPath);
      const projectCount = legacyTableExists(legacyDb, 'projects')
        ? (legacyDb.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number })
            .count
        : 0;
      const taskCount = legacyTableExists(legacyDb, 'tasks')
        ? (legacyDb.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }).count
        : 0;
      return { projects: projectCount, tasks: taskCount };
    } catch (error) {
      log.warn('legacy-port controller: failed to read preview counts', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { projects: 0, tasks: 0 };
    } finally {
      legacyDb?.close();
    }
  },

  runImport: async () => {
    const userDataPath = app.getPath('userData');
    try {
      await runLegacyPort(userDataPath);
      return { success: true };
    } catch (error) {
      log.error('legacy-port controller: import failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Import failed',
      };
    }
  },
});

import { count } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { app } from 'electron';
import type { LegacyImportSource } from '@core/primitives/legacy-port/api/legacy-port';
import * as schema from '@core/services/app-db/node/schema';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { log } from '@main/lib/logger';
import { openLegacyReadOnly } from './legacy-source/open-readonly';
import {
  hasBetaDatabaseFile,
  hasLegacyDatabaseFile,
  resolveExistingBetaDatabasePath,
  resolveExistingLegacyDatabasePath,
} from './legacy-source/path';
import { createDefaultLegacyPortStateStore, runLegacyPort } from './service';
import { createLegacyPortPreview } from './source-analysis';

export const legacyPortOperations = {
  checkStatus: async () => {
    const userDataPath = app.getPath('userData');
    const hasLegacyDb = hasLegacyDatabaseFile(userDataPath);
    const hasBetaDb = hasBetaDatabaseFile(userDataPath);
    const stateStore = await createDefaultLegacyPortStateStore();
    const portStatus = await stateStore.getStatus();
    const [{ value: projectCount }] = await getAppDb().select({ value: count() }).from(projects);
    const [{ value: taskCount }] = await getAppDb().select({ value: count() }).from(tasks);
    const hasExistingData = projectCount > 0 || taskCount > 0;
    return {
      hasLegacyDb,
      hasBetaDb,
      hasImportSources: hasLegacyDb || hasBetaDb,
      portStatus: portStatus ?? null,
      hasExistingData,
    };
  },

  getPreview: async () => {
    const userDataPath = app.getPath('userData');
    const hasLegacyDb = hasLegacyDatabaseFile(userDataPath);
    const hasBetaDb = hasBetaDatabaseFile(userDataPath);
    const legacyPath = resolveExistingLegacyDatabasePath(userDataPath);
    const betaPath = resolveExistingBetaDatabasePath(userDataPath);
    let legacyDb;
    let betaSqlite;
    try {
      legacyDb = hasLegacyDb ? openLegacyReadOnly(legacyPath) : null;
      betaSqlite = hasBetaDb ? openLegacyReadOnly(betaPath) : null;
      return await createLegacyPortPreview({
        appDb: getAppDb(),
        betaDb: betaSqlite ? drizzle(betaSqlite, { schema }) : null,
        legacyDb,
        hasLegacyDb,
        hasBetaDb,
      });
    } catch (error) {
      log.warn('legacy-port controller: failed to read preview counts', {
        error: error instanceof Error ? error.message : String(error),
      });
      return await createLegacyPortPreview({
        appDb: getAppDb(),
        betaDb: null,
        legacyDb: null,
        hasLegacyDb,
        hasBetaDb,
      });
    } finally {
      legacyDb?.close();
      betaSqlite?.close();
    }
  },

  runImport: async (args?: {
    sources?: LegacyImportSource[];
    conflictChoices?: Record<string, LegacyImportSource>;
  }) => {
    const userDataPath = app.getPath('userData');
    try {
      await runLegacyPort(userDataPath, {
        sources: args?.sources,
        conflictChoices: args?.conflictChoices,
      });
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
};

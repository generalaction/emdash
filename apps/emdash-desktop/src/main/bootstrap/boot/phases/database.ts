import type Database from 'better-sqlite3';
import { resetStaleAcpAgentStatuses } from '@core/features/conversations/node/reset-stale-acp-agent-statuses';
import { resetStaleTuiAgentStatuses } from '@core/features/conversations/node/reset-stale-tui-agent-statuses';
import {
  createEditorBufferService,
  type EditorBufferService,
} from '@core/features/editor/node/editor-buffer-service';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { createWorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-source';
import { appSettingsContributions } from '@core/manifests/shared/settings-contributions';
import type { AppDb } from '@core/services/app-db/node/db';
import { createAppSettingsService, type AppSettingsService } from '@core/services/settings/node';
import { createDrizzleClient } from '@main/db/drizzleClient';
import { initializeDatabase } from '@main/db/initialize';
import { closeAppDb, setAppDb } from '@main/db/instance';
import { cleanupLegacyBrowserPartitions } from '@main/host/browser/browser-partition-cleanup';
import { log } from '@main/lib/logger';
import { runInBackground } from '../../core/background';
import { writeBootingMarker } from '../../core/boot-guard';
import type { AppConfig } from '../../core/config';
import { setWorkspaceIdentityService } from '../../core/service-instances';

export type DatabaseBundle = {
  readonly appSettings: AppSettingsService;
  readonly db: AppDb;
  readonly editorBuffer: EditorBufferService;
  readonly sqlite: Database.Database;
  readonly workspaceIdentity: WorkspaceIdentityService;
};

export async function bootDatabase(config: AppConfig): Promise<DatabaseBundle> {
  writeBootingMarker(config);
  if (config.forceBootFailure) {
    throw new Error('Boot failure forced by EMDASH_FORCE_BOOT_FAILURE=1');
  }

  const client = createDrizzleClient();
  let published = false;
  try {
    await initializeDatabase(client.sqlite);
    setAppDb(client);
    published = true;
    const workspaceIdentity = createWorkspaceIdentityService({ db: client.db });
    const editorBuffer = createEditorBufferService({ db: client.db, logger: log });
    const appSettings = createAppSettingsService({
      db: client.db,
      contributions: appSettingsContributions,
    });
    setWorkspaceIdentityService(workspaceIdentity);
    await runStartupRepairs(client.db, editorBuffer);
    return {
      appSettings,
      db: client.db,
      editorBuffer,
      sqlite: client.sqlite,
      workspaceIdentity,
    };
  } catch (error) {
    if (published) closeAppDb();
    else client.close();
    throw error;
  }
}

async function runStartupRepairs(db: AppDb, editorBuffer: EditorBufferService): Promise<void> {
  await resetStaleAcpAgentStatuses(db);
  await resetStaleTuiAgentStatuses(db);

  runInBackground('editor-buffer-prune', () => editorBuffer.pruneStale(), {
    onError: (error) => log.warn('Failed to prune stale editor buffers', { error }),
  });
  runInBackground('browser-partition-cleanup', cleanupLegacyBrowserPartitions, {
    onError: (error) => log.warn('Failed to clean legacy browser partitions', { error }),
  });
}

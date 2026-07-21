import { sql } from 'drizzle-orm';
import { resetStaleAcpAgentStatuses } from '@core/features/conversations/node/reset-stale-acp-agent-statuses';
import { resetStaleTuiAgentStatuses } from '@core/features/conversations/node/reset-stale-tui-agent-statuses';
import { createEditorBufferService } from '@core/features/editor/node/editor-buffer-service';
import { createWorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-source';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { createDrizzleClient } from '@main/db/drizzleClient';
import { initializeDatabase } from '@main/db/initialize';
import { setAppDb } from '@main/db/instance';
import { getMementosRuntimeClient } from '@main/gateway/desktop-workers';
import { cleanupLegacyBrowserPartitions } from '@main/host/browser/browser-partition-cleanup';
import { log } from '@main/lib/logger';
import { runInBackground } from '../../core/background';
import { writeBootingMarker } from '../../core/boot-guard';
import type { Phase } from '../../core/phase';
import { setWorkspaceIdentityService } from '../../core/service-instances';
import type { BootContext } from '../types';

export const databasePhase: Phase<BootContext> = {
  name: 'database',
  async run(context) {
    const { config } = context;
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
      const editorBufferService = createEditorBufferService({ db: client.db, logger: log });
      setWorkspaceIdentityService(workspaceIdentity);
      context.db = client.db;
      context.sqlite = client.sqlite;
      context.editorBufferService = editorBufferService;
      context.workspaceIdentity = workspaceIdentity;
      await runStartupRepairs(context);
    } catch (error) {
      if (!published) client.close();
      throw error;
    }
  },
};

async function runStartupRepairs(context: BootContext): Promise<void> {
  const db = context.db;
  const editorBufferService = context.editorBufferService;
  if (!db || !editorBufferService) {
    throw new Error('Database services were not initialized before startup repairs');
  }
  await resetStaleAcpAgentStatuses(db);
  await resetStaleTuiAgentStatuses(db);

  runInBackground('editor-buffer-prune', () => editorBufferService.pruneStale(), {
    onError: (error) => log.warn('Failed to prune stale editor buffers', { error }),
  });
  runInBackground('browser-partition-cleanup', cleanupLegacyBrowserPartitions, {
    onError: (error) => log.warn('Failed to clean legacy browser partitions', { error }),
  });

  try {
    const [taskRows, projectRows, mementos] = await Promise.all([
      db.select({ id: tasks.id }).from(tasks),
      db.select({ id: projects.id }).from(projects),
      getMementosRuntimeClient(),
    ]);
    const [taskResult, projectResult] = await Promise.all([
      mementos.deleteOrphans({ kind: 'task', validKeys: taskRows.map(({ id }) => id) }),
      mementos.deleteOrphans({ kind: 'project', validKeys: projectRows.map(({ id }) => id) }),
    ]);
    if (!taskResult.success) throw new Error(taskResult.error.message);
    if (!projectResult.success) throw new Error(projectResult.error.message);
    db.run(sql`DELETE FROM kv WHERE key LIKE 'view-state:%'`);
  } catch (error) {
    log.warn('mementos: failed to prune orphaned entries', { error });
  }
}

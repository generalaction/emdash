import { sql } from 'drizzle-orm';
import { editorBufferService } from '@core/features/editor/node/editor-buffer-service';
import { searchService } from '@core/features/search/node/search-service';
import { resetStaleAcpAgentStatuses } from '@main/core/conversations/reset-stale-acp-agent-statuses';
import { resetStaleTuiAgentStatuses } from '@main/core/conversations/reset-stale-tui-agent-statuses';
import { db } from '@main/db/client';
import { initializeDatabase } from '@main/db/initialize';
import { projects, tasks } from '@main/db/schema';
import { getMementosRuntimeClient } from '@main/gateway/desktop-workers';
import { cleanupLegacyBrowserPartitions } from '@main/host/browser/browser-partition-cleanup';
import { log } from '@main/lib/logger';
import { runInBackground } from '../../core/background';
import { writeBootingMarker } from '../../core/boot-guard';
import type { Phase } from '../../core/phase';
import type { BootContext } from '../types';

export const databasePhase: Phase<BootContext> = {
  name: 'database',
  async run({ config }) {
    writeBootingMarker(config);
    if (config.forceBootFailure) {
      throw new Error('Boot failure forced by EMDASH_FORCE_BOOT_FAILURE=1');
    }
    await initializeDatabase();
    await runStartupRepairs();
  },
};

async function runStartupRepairs(): Promise<void> {
  await resetStaleAcpAgentStatuses();
  await resetStaleTuiAgentStatuses();
  searchService.initialize();

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

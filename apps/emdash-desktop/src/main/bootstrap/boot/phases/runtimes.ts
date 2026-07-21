import { sql } from 'drizzle-orm';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { desktopRuntimes, type DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { startDesktopWorkers, type DesktopWorkersHandle } from '@main/gateway/desktop-workers';
import { createDesktopRuntimeBroker } from '@main/gateway/runtime-broker';
import { log } from '@main/lib/logger';
import { appScope } from '../../core/app-scope';
import { runInBackground } from '../../core/background';
import type { DatabaseBundle } from './database';
import type { InfrastructureBundle } from './infrastructure';

export async function bootRuntimes(
  database: DatabaseBundle,
  infrastructure: InfrastructureBundle
): Promise<DesktopRuntimes> {
  const scope = appScope.child('runtimes');
  let workers: DesktopWorkersHandle | undefined;
  try {
    workers = await startDesktopWorkers({
      scope,
      getLocalProjectSettings: () => database.appSettings.get('localProject'),
    });
    const broker = createDesktopRuntimeBroker(workers.clients, infrastructure.workspaceServer);
    runMementosOrphanPruning(database, workers.clients.mementos);
    return desktopRuntimes(workers, broker, scope);
  } catch (error) {
    try {
      await workers?.dispose();
    } finally {
      await scope.dispose(error);
    }
    throw error;
  }
}

function runMementosOrphanPruning(
  database: DatabaseBundle,
  mementos: DesktopRuntimes['clients']['mementos']
): void {
  runInBackground(
    'mementos-orphan-pruning',
    async () => {
      const [taskRows, projectRows] = await Promise.all([
        database.db.select({ id: tasks.id }).from(tasks),
        database.db.select({ id: projects.id }).from(projects),
      ]);
      const [taskResult, projectResult] = await Promise.all([
        mementos.deleteOrphans({ kind: 'task', validKeys: taskRows.map(({ id }) => id) }),
        mementos.deleteOrphans({ kind: 'project', validKeys: projectRows.map(({ id }) => id) }),
      ]);
      if (!taskResult.success) throw new Error(taskResult.error.message);
      if (!projectResult.success) throw new Error(projectResult.error.message);
      database.db.run(sql`DELETE FROM kv WHERE key LIKE 'view-state:%'`);
    },
    {
      onError: (error) => log.warn('mementos: failed to prune orphaned entries', { error }),
    }
  );
}

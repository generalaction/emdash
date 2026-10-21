import { sql } from 'drizzle-orm';
import {
  conversationRegistryTable as conversations,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import { conversationSubject } from '@core/features/conversations/contributions/subject';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { desktopRuntimes, type DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { startDesktopWorkers, type DesktopWorkersHandle } from '@main/gateway/desktop-workers';
import { createDesktopHostAvailability } from '@main/gateway/host-availability';
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
      getFilesSettings: () => database.appSettings.get('files'),
    });
    const runtimeWorkers = workers;
    const broker = createDesktopRuntimeBroker(runtimeWorkers.clients, infrastructure.hosts);
    scope.add(() => broker.dispose());
    const hostAvailability = createDesktopHostAvailability({
      scope,
      hosts: infrastructure.hosts,
      runtimes: broker,
      localReady: () => runtimeWorkers.runtimeReady(),
    });
    runMementosOrphanPruning(database, runtimeWorkers.clients.mementos);
    return desktopRuntimes(runtimeWorkers, broker, hostAvailability, scope);
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
      const [conversationRows, taskRows, projectRows] = await Promise.all([
        database.db.select({ id: conversations.id }).from(conversations).where(liveConversations()),
        database.db.select({ id: tasks.id }).from(tasks),
        database.db.select({ id: projects.id }).from(projects),
      ]);
      const [conversationResult, taskResult, projectResult] = await Promise.all([
        mementos.deleteOrphans({
          kind: conversationSubject.kind,
          validKeys: conversationRows.map(({ id }) => id),
        }),
        mementos.deleteOrphans({
          kind: taskSubject.kind,
          validKeys: taskRows.map(({ id }) => id),
        }),
        mementos.deleteOrphans({
          kind: projectSubject.kind,
          validKeys: projectRows.map(({ id }) => id),
        }),
      ]);
      if (!conversationResult.success) throw new Error(conversationResult.error.message);
      if (!taskResult.success) throw new Error(taskResult.error.message);
      if (!projectResult.success) throw new Error(projectResult.error.message);
      database.db.run(sql`DELETE FROM kv WHERE key LIKE 'view-state:%'`);
    },
    {
      onError: (error) => log.warn('mementos: failed to prune orphaned entries', { error }),
    }
  );
}

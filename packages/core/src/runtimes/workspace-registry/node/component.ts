import path from 'node:path';
import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { fsWatchContract } from '@services/fs-watch/api';
import { createProcessWatchServiceFromDependency } from '@services/fs-watch/node/process-watch-service';
import { z } from 'zod';
import { workspaceRegistryContract } from '../api';
import { createWorkspaceRegistryController } from './api/controller';
import { workspaceRegistryStore } from './persistence/store';
import { WorkspaceRegistryRuntime } from './runtime';
import { WorkspaceScanScheduler } from './scan/scheduler';

export const workspaceRegistryComponentConfigSchema = z.object({
  databasePath: z
    .string()
    .min(1)
    .refine((value) => value === ':memory:' || path.isAbsolute(value), {
      message: 'Workspace registry database path must be absolute or :memory:',
    }),
  scan: z
    .object({
      debounceMs: z.number().positive().optional(),
      activeDebounceMs: z.number().positive().optional(),
      pollIntervalMs: z.number().positive().optional(),
    })
    .optional(),
});

/**
 * The dedicated workspace registry worker (ADR 0005): owns `workspace-registry.db`
 * exclusively — the sole writer of the host's workspace index. The fs-watch dependency
 * feeds the freshness scheduler; the polling floor bounds staleness when watching fails.
 */
export const workspaceRegistryComponent = defineWireComponent({
  id: 'workspace-registry',
  contract: workspaceRegistryContract,
  requirements: {
    watcher: requireContract(fsWatchContract),
  },
  configSchema: workspaceRegistryComponentConfigSchema,
  create: ({ config, dependencies, instance, logger, scope }) => {
    const handle = workspaceRegistryStore.open(config.databasePath);
    scope.add(() => handle.close());

    const runtime = new WorkspaceRegistryRuntime({ handle, logger });
    scope.add(() => runtime.dispose());

    const watcher = createProcessWatchServiceFromDependency({
      client: dependencies.watcher,
      logger,
      scope,
    });
    const scheduler = new WorkspaceScanScheduler({
      watcher,
      execute: (request) => runtime.executeScanRequest(request),
      listTargets: () => runtime.scanTargets(),
      isActive: (id) => runtime.isWorkspaceActive(id),
      logger,
      ...config.scan,
    });
    runtime.setOnRecordsChanged(() => scheduler.syncWatches());
    scheduler.start();
    scope.add(() => scheduler.dispose());

    // Boot reconciliation: catch up with whatever changed while the daemon was down.
    void runtime.scanHost().catch((error) => {
      logger.warn?.(`initial workspace registry scan failed: ${String(error)}`);
    });

    return instance({
      scope,
      controller: createWorkspaceRegistryController(runtime),
    });
  },
});

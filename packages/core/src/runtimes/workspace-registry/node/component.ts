import path from 'node:path';
import { defineWireComponent } from '@emdash/wire/component';
import { z } from 'zod';
import { workspaceRegistryContract } from '../api';
import { createWorkspaceRegistryController } from './api/controller';
import { workspaceRegistryStore } from './persistence/store';
import { WorkspaceRegistryRuntime } from './runtime';

export const workspaceRegistryComponentConfigSchema = z.object({
  databasePath: z
    .string()
    .min(1)
    .refine((value) => value === ':memory:' || path.isAbsolute(value), {
      message: 'Workspace registry database path must be absolute or :memory:',
    }),
});

/**
 * The dedicated workspace registry worker (ADR 0005): depends on nothing and owns
 * `workspace-registry.db` exclusively — the sole writer of the host's workspace index.
 */
export const workspaceRegistryComponent = defineWireComponent({
  id: 'workspace-registry',
  contract: workspaceRegistryContract,
  requirements: {},
  configSchema: workspaceRegistryComponentConfigSchema,
  create: ({ config, instance, logger, scope }) => {
    const handle = workspaceRegistryStore.open(config.databasePath);
    scope.add(() => handle.close());

    const runtime = new WorkspaceRegistryRuntime({ handle, logger });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createWorkspaceRegistryController(runtime),
    });
  },
});

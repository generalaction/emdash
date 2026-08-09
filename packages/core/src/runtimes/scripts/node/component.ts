import { defineWireComponent, requireContract } from '@emdash/wire/worker';
import { z } from 'zod';
import { NodePtySpawner } from '#services/pty/node';
import { hostRuntimesDefinitions } from '#services/runtime-broker/api';
import { scriptsContract } from '../api/contract';
import { createScriptsController } from './api/controller';
import { readWorkspaceScriptsConfig, ScriptsRuntime } from './runtime';

/**
 * The scripts worker: the single script execution plane on a host. Consumes the
 * host-settings runtime for the per-host default shellSetup; the workspace's own
 * `.emdash.json` (read leniently at each start via the shared config reader)
 * overrides it.
 */
export const scriptsComponent = defineWireComponent({
  id: 'scripts',
  contract: scriptsContract,
  requirements: {
    hostSettings: requireContract(hostRuntimesDefinitions.hostSettings),
  },
  configSchema: z.object({}),
  create: ({ dependencies, instance, logger, scope }) => {
    const runtime = new ScriptsRuntime({
      spawner: new NodePtySpawner(),
      readConfig: readWorkspaceScriptsConfig,
      defaultShellSetup: async () => {
        const result = await dependencies.hostSettings.get();
        return result.success ? result.data.settings.shellSetup : undefined;
      },
      logger,
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createScriptsController(runtime),
    });
  },
});

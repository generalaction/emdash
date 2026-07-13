import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { workspaceContract } from '@runtimes/workspace/api';
import { createWorkspaceController } from '@runtimes/workspace/node/api/controller';
import { WorkspaceRuntime } from '@runtimes/workspace/node/workspace-runtime';
import { fsWatchContract } from '@services/fs-watch/api';
import { createProcessWatchServiceFromDependency } from '@services/fs-watch/node/process-watch-service';
import { z } from 'zod';

export const workspaceComponentConfigSchema = z.object({});

export const workspaceComponent = defineWireComponent({
  id: 'workspace',
  contract: workspaceContract,
  requirements: {
    watcher: requireContract(fsWatchContract),
  },
  configSchema: workspaceComponentConfigSchema,
  create: ({ dependencies, instance, logger, scope }) => {
    const watcher = createProcessWatchServiceFromDependency({
      client: dependencies.watcher,
      logger,
      scope,
    });
    const runtime = new WorkspaceRuntime({
      watcher,
      scope,
      onError: (context, error) => logger.warn(context, { error }),
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createWorkspaceController(runtime, { validate: 'none' }),
    });
  },
});

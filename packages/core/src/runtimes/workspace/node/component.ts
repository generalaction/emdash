import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { z } from 'zod';
import { workspaceContract } from '@runtimes/workspace/api';
import { createWorkspaceController } from '@runtimes/workspace/node/api/controller';
import { WorkspaceRuntime } from '@runtimes/workspace/node/workspace-runtime';
import { fsWatchContract } from '@services/fs-watch/api';
import { processWatchBackend } from '@services/fs-watch/impl/process-backend';
import { createWatchService } from '@services/fs-watch/impl/watch-service';

export const workspaceComponentConfigSchema = z.object({});

export const workspaceComponent = defineWireComponent({
  id: 'workspace',
  contract: workspaceContract,
  requirements: {
    watcher: requireContract(fsWatchContract),
  },
  configSchema: workspaceComponentConfigSchema,
  create: ({ dependencies, instance, logger, scope }) => {
    const watcher = createWatchService({
      backend: processWatchBackend({
        client: dependencies.watcher,
        onError: (context, error) => logger.warn(context, { error }),
      }),
      scope,
      onError: (context, error) => logger.warn(context, { error }),
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

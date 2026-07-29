import { defineWireComponent, requireContract } from '@emdash/wire/component';
import {
  createNoopWorkspaceOperationRecordStore,
  workspaceContract,
} from '@runtimes/workspace/api';
import { createWorkspaceController } from '@runtimes/workspace/node/api/controller';
import { createFileWorkspaceOperationRecordStore } from '@runtimes/workspace/node/operation-record-store';
import { WorkspaceRuntime } from '@runtimes/workspace/node/workspace-runtime';
import { fsWatchContract } from '@services/fs-watch/api';
import { createProcessWatchServiceFromDependency } from '@services/fs-watch/node/process-watch-service';
import { scriptWorkflowsContract } from '@services/script-workflows/api';
import { z } from 'zod';

export const workspaceComponentConfigSchema = z.object({
  operationRecordsFilePath: z.string().min(1).optional(),
});

export const workspaceComponent = defineWireComponent({
  id: 'workspace',
  contract: workspaceContract,
  requirements: {
    terminals: requireContract(scriptWorkflowsContract),
    watcher: requireContract(fsWatchContract),
  },
  configSchema: workspaceComponentConfigSchema,
  create: ({ config, dependencies, instance, logger, scope }) => {
    const watcher = createProcessWatchServiceFromDependency({
      client: dependencies.watcher,
      logger,
      scope,
    });
    const runtime = new WorkspaceRuntime({
      terminals: dependencies.terminals,
      watcher,
      operationRecords: config.operationRecordsFilePath
        ? createFileWorkspaceOperationRecordStore({
            path: config.operationRecordsFilePath,
          })
        : createNoopWorkspaceOperationRecordStore(),
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

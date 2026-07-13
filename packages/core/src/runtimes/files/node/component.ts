import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { z } from 'zod';
import { filesContract } from '@runtimes/files/api';
import { createFilesController } from '@runtimes/files/node/api/controller';
import { FilesRuntime } from '@runtimes/files/node/files-runtime';
import { fsWatchContract } from '@services/fs-watch/api';
import { processWatchBackend } from '@services/fs-watch/impl/process-backend';
import { createWatchService } from '@services/fs-watch/impl/watch-service';

export const filesComponentConfigSchema = z.object({
  idleTtlMs: z.number().nonnegative().optional(),
  maxContentBytes: z.number().nonnegative().optional(),
});

export const filesComponent = defineWireComponent({
  id: 'files',
  contract: filesContract,
  requirements: {
    watcher: requireContract(fsWatchContract),
  },
  configSchema: filesComponentConfigSchema,
  create: ({ config, dependencies, instance, logger, scope }) => {
    const watcher = createWatchService({
      backend: processWatchBackend({
        client: dependencies.watcher,
        onError: (context, error) => logger.warn(context, { error }),
      }),
      scope,
      onError: (context, error) => logger.warn(context, { error }),
    });
    const runtime = new FilesRuntime({
      watcher,
      idleTtlMs: config.idleTtlMs,
      maxContentBytes: config.maxContentBytes,
      onError: (context, error) => logger.warn(context, { error }),
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createFilesController(runtime, { validate: 'none' }),
    });
  },
});

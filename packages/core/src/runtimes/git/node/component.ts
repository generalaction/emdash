import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { z } from 'zod';
import { gitContract } from '@runtimes/git/api';
import { createGitController } from '@runtimes/git/node/api/controller';
import { GitRuntime } from '@runtimes/git/node/git-runtime';
import { fsWatchContract } from '@services/fs-watch/api';
import { processWatchBackend } from '@services/fs-watch/impl/process-backend';
import { createWatchService } from '@services/fs-watch/impl/watch-service';

export const gitComponentConfigSchema = z.object({
  executable: z.string().min(1).optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
  idleTtlMs: z.number().nonnegative().optional(),
  aliasTtlMs: z.number().nonnegative().optional(),
  maxFileDiffStates: z.number().nonnegative().optional(),
  maxFileContentStates: z.number().nonnegative().optional(),
});

export const gitComponent = defineWireComponent({
  id: 'git',
  contract: gitContract,
  requirements: {
    watcher: requireContract(fsWatchContract),
  },
  configSchema: gitComponentConfigSchema,
  create: ({ config, dependencies, instance, logger, scope }) => {
    const watcher = createWatchService({
      backend: processWatchBackend({
        client: dependencies.watcher,
        onError: (context, error) => logger.warn(context, { error }),
      }),
      scope,
      onError: (context, error) => logger.warn(context, { error }),
    });
    const runtime = new GitRuntime({
      watcher,
      executable: config.executable,
      env: config.env as NodeJS.ProcessEnv | undefined,
      idleTtlMs: config.idleTtlMs,
      aliasTtlMs: config.aliasTtlMs,
      maxFileDiffStates: config.maxFileDiffStates,
      maxFileContentStates: config.maxFileContentStates,
      onError: (context, error) => logger.warn(context, { error }),
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createGitController(runtime, { validate: 'none' }),
    });
  },
});

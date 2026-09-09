import { defineWireComponent } from '@emdash/wire/worker';
import { z } from 'zod';
import { fsWatchContract } from '#services/fs-watch/api';
import { createFsWatchController } from '#services/fs-watch/impl/controller';
import { nativeWatchBackend } from '#services/fs-watch/impl/native-backend';
import { createWatchService } from '#services/fs-watch/impl/watch-service';

export const fsWatchComponentConfigSchema = z.object({});

export const fsWatchComponent = defineWireComponent({
  id: 'fs-watch',
  contract: fsWatchContract,
  requirements: {},
  configSchema: fsWatchComponentConfigSchema,
  create: ({ fatal, instance, logger, scope }) => {
    const onError = (context: string, error: unknown): void => logger.warn(context, { error });
    const backend = nativeWatchBackend({ onError });
    const service = createWatchService({
      scope,
      backend,
      onError,
    });
    const failureSignal = backend.failureSignal;
    const onBackendFailure = (): void =>
      fatal(failureSignal.reason ?? new Error('Native watcher backend failed'));
    failureSignal.addEventListener('abort', onBackendFailure, { once: true });
    scope.add(() => failureSignal.removeEventListener('abort', onBackendFailure));
    return instance({
      scope,
      controller: createFsWatchController({
        scope,
        service,
        onError,
      }),
    });
  },
});

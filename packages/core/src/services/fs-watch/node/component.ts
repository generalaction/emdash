import { defineWireComponent } from '@emdash/wire/component';
import { fsWatchContract } from '@services/fs-watch/api';
import { createFsWatchController } from '@services/fs-watch/impl/controller';
import { z } from 'zod';

export const fsWatchComponentConfigSchema = z.object({});

export const fsWatchComponent = defineWireComponent({
  id: 'fs-watch',
  contract: fsWatchContract,
  requirements: {},
  configSchema: fsWatchComponentConfigSchema,
  create: ({ instance, logger, scope }) =>
    instance({
      scope,
      controller: createFsWatchController({
        scope,
        onError: (context, error) => logger.warn(context, { error }),
      }),
    }),
});

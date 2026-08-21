import { defineWireComponent } from '@emdash/wire/worker';
import { z } from 'zod';
import { NodePtySpawner } from '#services/pty/node';
import { scriptsContract } from '../api/contract';
import { createScriptsController } from './api/controller';
import { ScriptsRuntime } from './runtime';

/** The scripts worker: a strict execution plane for already-resolved inputs. */
export const scriptsComponentConfigSchema = z.object({
  userEnv: z.record(z.string(), z.string()),
});

export const scriptsComponent = defineWireComponent({
  id: 'scripts',
  contract: scriptsContract,
  requirements: {},
  configSchema: scriptsComponentConfigSchema,
  create: ({ config, instance, logger, scope }) => {
    const runtime = new ScriptsRuntime({
      spawner: new NodePtySpawner(),
      userEnv: config.userEnv,
      logger,
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createScriptsController(runtime),
    });
  },
});

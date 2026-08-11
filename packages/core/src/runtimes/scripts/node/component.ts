import { defineWireComponent } from '@emdash/wire/worker';
import { z } from 'zod';
import { NodePtySpawner } from '#services/pty/node';
import { scriptsContract } from '../api/contract';
import { createScriptsController } from './api/controller';
import { ScriptsRuntime } from './runtime';

/** The scripts worker: a strict execution plane for already-resolved inputs. */
export const scriptsComponent = defineWireComponent({
  id: 'scripts',
  contract: scriptsContract,
  requirements: {},
  configSchema: z.object({}),
  create: ({ instance, logger, scope }) => {
    const runtime = new ScriptsRuntime({
      spawner: new NodePtySpawner(),
      logger,
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createScriptsController(runtime),
    });
  },
});

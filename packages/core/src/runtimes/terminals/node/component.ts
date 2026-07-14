import { defineWireComponent } from '@emdash/wire/component';
import { terminalsContract } from '@runtimes/terminals/api';
import { NodePtySpawner } from '@services/pty/node';
import { z } from 'zod';
import { createTerminalsController } from './api/controller';
import { TerminalsRuntime } from './runtime/runtime';

export const terminalsComponentConfigSchema = z.object({});

export const terminalsComponent = defineWireComponent({
  id: 'terminals',
  contract: terminalsContract,
  requirements: {},
  configSchema: terminalsComponentConfigSchema,
  create: ({ instance, scope }) => {
    const runtime = new TerminalsRuntime({
      spawner: new NodePtySpawner(),
      scope,
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createTerminalsController(runtime),
    });
  },
});

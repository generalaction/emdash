import { defineWireComponent } from '@emdash/wire/component';
import { idlePolicyConfigSchema } from '@primitives/io-activity/api';
import { terminalsContract } from '@runtimes/terminals/api';
import { NodeExecutionContext } from '@services/exec/api';
import { NodePtySpawner } from '@services/pty/node';
import { z } from 'zod';
import { createTerminalsController } from './api/controller';
import { TerminalsRuntime } from './runtime/runtime';

export const terminalsComponentConfigSchema = z.object({
  lifecycle: z
    .object({
      terminal: idlePolicyConfigSchema.optional(),
      backgroundScript: idlePolicyConfigSchema.optional(),
      sweepIntervalMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export const terminalsComponent = defineWireComponent({
  id: 'terminals',
  contract: terminalsContract,
  requirements: {},
  configSchema: terminalsComponentConfigSchema,
  create: ({ config, instance, scope }) => {
    const exec = new NodeExecutionContext({ env: process.env });
    const runtime = new TerminalsRuntime({
      spawner: new NodePtySpawner(),
      exec,
      scope,
      lifecycle: config.lifecycle,
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createTerminalsController(runtime),
    });
  },
});

import { defineWireComponent } from '@emdash/wire/worker';
import { z } from 'zod';
import { terminalsContract } from '#runtimes/terminals/api';
import { NodeExecutionContext } from '#services/exec/api';
import { createNodeTerminalShellResolver, NodePtySpawner } from '#services/pty/node';
import { idlePolicyConfigSchema } from '#services/session-lifecycle/api';
import { createTerminalsController } from './api/controller';
import { TerminalsRuntime } from './runtime/runtime';

export const terminalsComponentConfigSchema = z.object({
  userEnv: z.record(z.string(), z.string()),
  lifecycle: z
    .object({
      terminal: idlePolicyConfigSchema.optional(),
      sweepIntervalMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export const terminalsComponent = defineWireComponent({
  id: 'terminals',
  contract: terminalsContract,
  requirements: {},
  configSchema: terminalsComponentConfigSchema,
  create: ({ config, instance, logger, scope }) => {
    const exec = new NodeExecutionContext({ env: config.userEnv });
    const runtime = new TerminalsRuntime({
      spawner: new NodePtySpawner(),
      userEnv: config.userEnv,
      exec,
      scope,
      lifecycle: config.lifecycle,
      shellResolver: createNodeTerminalShellResolver({ env: config.userEnv }),
      logger,
    });
    scope.add(() => runtime.dispose());

    return instance({
      scope,
      controller: createTerminalsController(runtime),
    });
  },
});

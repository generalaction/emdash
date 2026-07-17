import type { Logger } from '@emdash/shared/logger';
import { defineWireComponent } from '@emdash/wire/component';
import { z } from 'zod';
import { automationsContract } from '../api';
import { createAutomationsController } from '../api/controller';
import type { AutomationSessionPort, AutomationWorkspacePort } from './ports';
import { AutomationsRuntime } from './runtime';
import { automationsStore } from './sqlite/store';

export const automationsComponentConfigSchema = z.object({
  dbFile: z.string().min(1),
  tickIntervalMs: z.number().int().positive().optional(),
  maxConcurrentRuns: z.number().int().positive().optional(),
});

export type CreateAutomationsComponentOptions = {
  workspacePort: AutomationWorkspacePort;
  sessionPort: AutomationSessionPort;
  logger?: Logger;
};

export function createAutomationsComponent(options: CreateAutomationsComponentOptions) {
  return defineWireComponent({
    id: 'automations',
    contract: automationsContract,
    requirements: {},
    configSchema: automationsComponentConfigSchema,
    create: ({ config, instance, logger, scope }) => {
      const runtimeLogger = options.logger ?? logger;
      const handle = automationsStore.open(config.dbFile);
      scope.add(() => handle.close());

      const runtime = new AutomationsRuntime({
        handle,
        workspacePort: options.workspacePort,
        sessionPort: options.sessionPort,
        logger: runtimeLogger,
        tickIntervalMs: config.tickIntervalMs,
        maxConcurrentRuns: config.maxConcurrentRuns,
      });

      runtime.start();
      scope.add(() => runtime.dispose());

      return instance({
        scope,
        controller: createAutomationsController(runtime),
      });
    },
  });
}

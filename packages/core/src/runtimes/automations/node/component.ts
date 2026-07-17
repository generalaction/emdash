import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { acpSessionStartContract, tuiSessionStartContract } from '@services/session-start/api';
import { workspaceProvisioningContract } from '@services/workspace-provisioning/api';
import { z } from 'zod';
import { automationsContract } from '../api';
import { createAutomationsController } from '../api/controller';
import { AutomationsRuntime } from './runtime';
import { createSessionPortFromDependencies } from './session-port';
import { automationsStore } from './sqlite/store';
import { createWorkspacePortFromDependency } from './workspace-port';

export const automationsComponentConfigSchema = z.object({
  dbFile: z.string().min(1),
  tickIntervalMs: z.number().int().positive().optional(),
  maxConcurrentRuns: z.number().int().positive().optional(),
});

export function createAutomationsComponent() {
  return defineWireComponent({
    id: 'automations',
    contract: automationsContract,
    requirements: {
      workspace: requireContract(workspaceProvisioningContract),
      acpSessions: requireContract(acpSessionStartContract),
      tuiSessions: requireContract(tuiSessionStartContract),
    },
    configSchema: automationsComponentConfigSchema,
    create: ({ config, dependencies, instance, logger, scope }) => {
      const handle = automationsStore.open(config.dbFile);
      scope.add(() => handle.close());

      const runtime = new AutomationsRuntime({
        handle,
        workspacePort: createWorkspacePortFromDependency(dependencies.workspace, scope),
        sessionPort: createSessionPortFromDependencies({
          acp: dependencies.acpSessions,
          tui: dependencies.tuiSessions,
        }),
        logger,
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

import { defineWireComponent, requireContract } from '@emdash/wire/component';
// oxlint-disable-next-line emdash/core-module-boundaries -- runs await the registry's plain createWorktree verb (operation-log retirement §5); the contract has no services-level home yet
import { workspaceRegistryContract } from '@runtimes/workspace-registry/api';
import { conversationIndexContract } from '@services/conversation-index/api';
import { acpSessionStartContract, tuiSessionStartContract } from '@services/session-start/api';
import { workspaceHostActionsContract } from '@services/workspace-host-actions/api';
import { z } from 'zod';
import { automationsContract } from '../api';
import { createAutomationsController } from './api/controller';
import { automationsStore } from './persistence/store';
import { createSessionPortFromDependencies } from './ports/session-start';
import { createWorkspacePortFromDependency } from './ports/workspace-provisioning';
import { AutomationsRuntime } from './runtime';

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
      workspaceHost: requireContract(workspaceHostActionsContract),
      workspaceRegistry: requireContract(workspaceRegistryContract),
      acpSessions: requireContract(acpSessionStartContract),
      tuiSessions: requireContract(tuiSessionStartContract),
      conversationIndex: requireContract(conversationIndexContract),
    },
    configSchema: automationsComponentConfigSchema,
    create: ({ config, dependencies, instance, logger, scope }) => {
      const handle = automationsStore.open(config.dbFile);
      scope.add(() => handle.close());

      const runtime = new AutomationsRuntime({
        handle,
        workspacePort: createWorkspacePortFromDependency(dependencies.workspaceRegistry),
        sessionPort: createSessionPortFromDependencies({
          workspaceHost: dependencies.workspaceHost,
          acp: dependencies.acpSessions,
          tui: dependencies.tuiSessions,
          conversationIndex: dependencies.conversationIndex,
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

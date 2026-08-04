import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { workspaceHostContract } from '@runtimes/workspace-host/api';
import { hostRuntimesDefinitions } from '@services/runtime-broker/api';
import { z } from 'zod';
import { createWorkspaceHostController } from './controller';
import { WorkspaceHostSessionGc } from './session/session-gc';
import { WorkspaceHostRuntime } from './workspace-host-runtime';

export const workspaceHostComponentConfigSchema = z.object({
  stateDirectory: z.string().min(1),
  sessionGcIntervalMs: z.number().int().positive().optional(),
});

export const workspaceHostComponent = defineWireComponent({
  id: 'workspace-host',
  contract: workspaceHostContract,
  requirements: {
    acp: requireContract(hostRuntimesDefinitions.acp),
    terminals: requireContract(hostRuntimesDefinitions.terminals),
    tuiAgents: requireContract(hostRuntimesDefinitions.tuiAgents),
  },
  configSchema: workspaceHostComponentConfigSchema,
  create: ({ config, dependencies, instance, logger, scope }) => {
    const sessions = {
      acp: dependencies.acp,
      terminals: dependencies.terminals,
      tuiAgents: dependencies.tuiAgents,
    };
    const runtime = new WorkspaceHostRuntime({
      stateDirectory: config.stateDirectory,
      sessions,
      scope,
    });
    const gc = new WorkspaceHostSessionGc({
      clients: sessions,
      intervalMs: config.sessionGcIntervalMs ?? 60_000,
      scope,
      onError: (error) => logger.warn('workspace-host session GC failed', { error }),
    });
    gc.start();

    return instance({
      scope,
      controller: createWorkspaceHostController(runtime, { validate: 'none' }),
    });
  },
});

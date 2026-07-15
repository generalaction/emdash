import os from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { defineWireComponent, requireContract } from '@emdash/wire/component';
import { tuiAgentsContract } from '@runtimes/tui-agents/api';
import { createTuiAgentsController } from '@runtimes/tui-agents/node/api/controller';
import { TuiAgentsRuntime } from '@runtimes/tui-agents/node/runtime/runtime';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '@services/exec/api';
import { idlePolicyConfigSchema } from '@primitives/io-activity/api';
import {
  createHostDependencyResolverFromDependency,
  hostDependencyResolverContract,
} from '@services/host-dependencies/node';
import { NodePtySpawner } from '@services/pty/node';
import {
  createFileSessionIntentStore,
  createNoopSessionIntentStore,
} from '@services/session-intents/node';
import { z } from 'zod';

export const tuiAgentsComponentConfigSchema = z.object({
  hook: z.object({ port: z.number().int().positive(), token: z.string() }).optional(),
  intentsFilePath: z.string().min(1).optional(),
  lifecycle: z
    .object({
      session: idlePolicyConfigSchema.optional(),
      sweepIntervalMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export type CreateTuiAgentsComponentOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
};

export function createTuiAgentsComponent(options: CreateTuiAgentsComponentOptions) {
  return defineWireComponent({
    id: 'tui-agents',
    contract: tuiAgentsContract,
    requirements: {
      hostDependencies: requireContract(hostDependencyResolverContract),
    },
    configSchema: tuiAgentsComponentConfigSchema,
    create: ({ config, dependencies, instance, logger, scope }) => {
      const env = options.env ?? process.env;
      const runtimeLogger = options.logger ?? logger;
      const homeDir = os.homedir();
      const exec = new NodeExecutionContext({ env });
      const dependencyResolver = createHostDependencyResolverFromDependency(
        dependencies.hostDependencies
      );
      const intents = config.intentsFilePath
        ? createFileSessionIntentStore({ path: config.intentsFilePath, scope: 'tui-agents' })
        : createNoopSessionIntentStore();
      const agentHost = new AgentPluginHost({
        scope,
        registry: options.pluginRegistry,
        exec,
        dependencies: dependencyResolver,
        fs: createLocalPluginFs(homeDir),
        env,
        homeDir,
      });
      const runtime = new TuiAgentsRuntime({
        agentHost,
        exec,
        intents,
        spawner: new NodePtySpawner(),
        hook: config.hook,
        lifecycle: config.lifecycle,
        logger: runtimeLogger,
      });
      void runtime.reconcile();
      scope.add(() => runtime.dispose());

      return instance({
        scope,
        controller: createTuiAgentsController(runtime),
      });
    },
  });
}

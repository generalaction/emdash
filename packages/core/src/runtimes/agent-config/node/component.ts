import os from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { defineWireComponent } from '@emdash/wire/component';
import { agentConfigContract } from '@runtimes/agent-config/api';
import { createAgentConfigController } from '@runtimes/agent-config/node/api/controller';
import { createExecInstallCommandRunner } from '@runtimes/agent-config/node/node/install-command-runner';
import { AgentConfigRuntime } from '@runtimes/agent-config/node/runtime/runtime';
import {
  AgentPluginHost,
  buildDescriptorFromProvider,
  type CLIAgentPluginProvider,
} from '@services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '@services/exec/api';
import { HostDependencyManager } from '@services/host-dependencies/node';
import { NodePtySpawner } from '@services/pty/node';
import { z } from 'zod';

export const agentConfigComponentConfigSchema = z.object({});

export type CreateAgentConfigComponentOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
};

export function createAgentConfigComponent(options: CreateAgentConfigComponentOptions) {
  return defineWireComponent({
    id: 'agent-config',
    contract: agentConfigContract,
    requirements: {},
    configSchema: agentConfigComponentConfigSchema,
    create: ({ instance, logger, scope }) => {
      const env = options.env ?? process.env;
      const runtimeLogger = options.logger ?? logger;
      const homeDir = os.homedir();
      const spawner = new NodePtySpawner();
      const exec = new NodeExecutionContext({ env });
      const dependencyDescriptors = options.pluginRegistry
        .getAll()
        .map(buildDescriptorFromProvider);
      const dependencyManager = new HostDependencyManager(exec, {
        dependencies: dependencyDescriptors,
        getDependencyDescriptor: (id) =>
          dependencyDescriptors.find((descriptor) => descriptor.id === id),
        logger: scope.log,
      });
      const agentHost = new AgentPluginHost({
        scope,
        registry: options.pluginRegistry,
        exec,
        dependencies: dependencyManager,
        fs: createLocalPluginFs(homeDir),
        env,
        homeDir,
      });
      const runtime = new AgentConfigRuntime({
        scope,
        agentHost,
        ptySpawner: spawner,
        logger: runtimeLogger,
        installCommandRunner: createExecInstallCommandRunner({
          cwd: homeDir,
          env,
          shell: env.SHELL ?? '/bin/sh',
        }),
      });

      return instance({
        scope,
        controller: createAgentConfigController(runtime),
      });
    },
  });
}

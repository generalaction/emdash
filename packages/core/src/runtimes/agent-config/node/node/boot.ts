import os from 'node:os';
import { initProcessLogging } from '@emdash/shared/logger/node';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { validation } from '@emdash/wire/api';
import { serveWireWorker, workerValidatePolicy, type WorkerParentPort } from '@emdash/wire/worker';
import { agentConfigContract } from '@runtimes/agent-config/api';
import { createAgentConfigController } from '@runtimes/agent-config/node/api/controller';
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
import { createExecInstallCommandRunner } from './install-command-runner';

export type BootAgentConfigRuntimeProcessOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  port?: WorkerParentPort;
  exit?: (code: number) => void;
};

export function bootAgentConfigRuntimeProcess(options: BootAgentConfigRuntimeProcessOptions): void {
  const env = options.env ?? process.env;
  const logger = initProcessLogging({ name: 'agent-config-runtime', env });

  void serveWireWorker(
    ({ scope }) => {
      const homeDir = os.homedir();
      const spawner = new NodePtySpawner();
      const runtimeScope = scope.child('agent-config-runtime');
      const exec = new NodeExecutionContext({ env });
      const dependencyDescriptors = options.pluginRegistry.getAll().map(buildDescriptorFromProvider);
      const dependencyManager = new HostDependencyManager(exec, {
        dependencies: dependencyDescriptors,
        getDependencyDescriptor: (id) =>
          dependencyDescriptors.find((descriptor) => descriptor.id === id),
        logger: runtimeScope.log,
      });
      const agentHost = new AgentPluginHost({
        scope: runtimeScope,
        registry: options.pluginRegistry,
        exec,
        dependencies: dependencyManager,
        fs: createLocalPluginFs(homeDir),
        env,
        homeDir,
      });
      const runtime = new AgentConfigRuntime({
        scope: runtimeScope,
        agentHost,
        ptySpawner: spawner,
        logger,
        installCommandRunner: createExecInstallCommandRunner({
          cwd: homeDir,
          env,
          shell: env.SHELL ?? '/bin/sh',
        }),
      });
      return createAgentConfigController(runtime);
    },
    {
      port: options.port,
      exit: options.exit,
      logger,
      middleware: [validation(agentConfigContract, workerValidatePolicy(env))],
    }
  );
}

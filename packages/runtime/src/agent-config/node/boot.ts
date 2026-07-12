import os from 'node:os';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { createLocalPluginFs } from '@emdash/core/agents/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/exec';
import { NodePtySpawner } from '@emdash/core/pty/node';
import { agentConfigContract } from '@emdash/core/workspace-server';
import { initProcessLogging } from '@emdash/shared/logger/node';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { validation } from '@emdash/wire/api';
import { serveWireWorker, workerValidatePolicy, type WorkerParentPort } from '@emdash/wire/worker';
import { createAgentConfigController } from '../api/controller';
import { AgentConfigRuntime } from '../runtime/runtime';
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
      const agentHost = new AgentPluginHost({
        scope: runtimeScope,
        registry: options.pluginRegistry,
        exec: new NodeExecutionContext({ env }),
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

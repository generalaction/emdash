import os from 'node:os';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { createLocalPluginFs } from '@emdash/core/agents/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/exec';
import { NodePtySpawner } from '@emdash/core/pty/node';
import { agentConfigContract } from '@emdash/core/workspace-server';
import { initProcessLogging } from '@emdash/shared/logger/node';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { withValidation, type ValidatePolicy } from '@emdash/wire';
import { serveProcessRuntime, type ProcessRuntimePort } from '@emdash/wire/util/process-runtime';
import { createAgentConfigController } from '../api/controller';
import { AgentConfigRuntime } from '../runtime/runtime';
import { createPtyInstallCommandRunner } from './install-command-runner';

export type BootAgentConfigRuntimeProcessOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  port?: ProcessRuntimePort;
  exit?: (code: number) => void;
};

export function bootAgentConfigRuntimeProcess(options: BootAgentConfigRuntimeProcessOptions): void {
  const env = options.env ?? process.env;
  const logger = initProcessLogging({ name: 'agent-config-runtime', env });

  void serveProcessRuntime(
    (scope) => {
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
        installCommandRunner: createPtyInstallCommandRunner({
          spawner,
          cwd: homeDir,
          env,
          shell: env.SHELL ?? '/bin/sh',
        }),
      });
      return withValidation(
        agentConfigContract,
        createAgentConfigController(runtime),
        runtimeWireValidationPolicy(env)
      );
    },
    { port: options.port, exit: options.exit, logger }
  ).catch((error: unknown) => {
    logger.error('Agent-config runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

function runtimeWireValidationPolicy(env: NodeJS.ProcessEnv): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

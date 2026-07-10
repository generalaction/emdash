import os from 'node:os';
import { agentConfigContract } from '@emdash/core/workspace-server';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { createLocalPluginFs } from '@emdash/core/agents/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/exec';
import { NodePtySpawner } from '@emdash/core/pty/node';
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
  const runtimePort = options.port ?? createNodeRuntimePort();
  const logger = initProcessLogging({ name: 'agent-config-runtime', env });

  void serveProcessRuntime(
    (scope) => {
      const homeDir = os.homedir();
      const spawner = new NodePtySpawner();
      const runtime = new AgentConfigRuntime({
        pluginHost: new AgentPluginHost(options.pluginRegistry),
        ptySpawner: spawner,
        exec: new NodeExecutionContext({ env }),
        pluginFs: createLocalPluginFs(homeDir),
        homeDir,
        env,
        logger,
        installCommandRunner: createPtyInstallCommandRunner({
          spawner,
          cwd: homeDir,
          env,
          shell: env.SHELL ?? '/bin/sh',
        }),
      });
      scope.add(() => runtime.dispose());
      return withValidation(
        agentConfigContract,
        createAgentConfigController(runtime),
        runtimeWireValidationPolicy(env)
      );
    },
    { port: runtimePort, exit: options.exit, logger }
  ).catch((error: unknown) => {
    logger.error('Agent-config runtime process failed', { error: errorMessage(error) });
    (options.exit ?? process.exit)(1);
  });
}

function runtimeWireValidationPolicy(env: NodeJS.ProcessEnv): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

function createNodeRuntimePort(): ProcessRuntimePort {
  if (typeof process.send !== 'function') {
    throw new Error('Agent-config runtime process requires an IPC channel to the parent process');
  }

  return {
    send(message) {
      process.send?.(message as Parameters<NonNullable<NodeJS.Process['send']>>[0]);
    },
    onMessage(cb) {
      process.on('message', cb);
      return () => process.off('message', cb);
    },
    onDisconnect(cb) {
      process.on('disconnect', cb);
      return () => process.off('disconnect', cb);
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

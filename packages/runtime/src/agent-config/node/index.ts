import os from 'node:os';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { createLocalPluginFs } from '@emdash/core/agents/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/exec';
import { NodePtySpawner } from '@emdash/core/pty/node';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { createScope } from '@emdash/wire/util';
import { AgentConfigRuntime } from '../runtime/runtime';
import { createExecInstallCommandRunner } from './install-command-runner';

export { bootAgentConfigRuntimeProcess, type BootAgentConfigRuntimeProcessOptions } from './boot';
export { createExecInstallCommandRunner } from './install-command-runner';

export type CreateNodeAgentConfigRuntimeOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  logger: Logger;
};

export function createNodeAgentConfigRuntime(
  options: CreateNodeAgentConfigRuntimeOptions
): AgentConfigRuntime {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const scope = createScope({ label: 'agent-config-runtime', logger: options.logger });
  const spawner = new NodePtySpawner();
  const agentHost = new AgentPluginHost({
    scope,
    registry: options.pluginRegistry,
    exec: new NodeExecutionContext({ env }),
    fs: createLocalPluginFs(homeDir),
    env,
    homeDir,
  });
  const runtime = new AgentConfigRuntime({
    scope,
    agentHost,
    ptySpawner: spawner,
    logger: options.logger,
    installCommandRunner: createExecInstallCommandRunner({
      cwd: homeDir,
      env,
      shell: env.SHELL ?? '/bin/sh',
    }),
  });
  return runtime;
}

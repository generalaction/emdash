import os from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { createScope } from '@emdash/wire/util';
import { AgentConfigRuntime } from '@runtimes/agent-config/node/runtime/runtime';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '@services/exec/api';
import { NodePtySpawner } from '@services/pty/node';
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

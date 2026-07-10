import os from 'node:os';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { createLocalPluginFs } from '@emdash/core/agents/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/exec';
import { NodePtySpawner } from '@emdash/core/pty/node';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { AgentConfigRuntime } from '../runtime/runtime';
import type { AgentConfigRuntimeDeps } from '../runtime/types';
import { createPtyInstallCommandRunner } from './install-command-runner';

export {
  bootAgentConfigRuntimeProcess,
  type BootAgentConfigRuntimeProcessOptions,
} from './boot';
export { createPtyInstallCommandRunner } from './install-command-runner';

export type CreateNodeAgentConfigRuntimeOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  logger: Logger;
  resolveSpawnContext?: AgentConfigRuntimeDeps['resolveSpawnContext'];
};

export function createNodeAgentConfigRuntime(
  options: CreateNodeAgentConfigRuntimeOptions
): AgentConfigRuntime {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const spawner = new NodePtySpawner();
  return new AgentConfigRuntime({
    pluginHost: new AgentPluginHost(options.pluginRegistry),
    ptySpawner: spawner,
    exec: new NodeExecutionContext({ env }),
    pluginFs: createLocalPluginFs(homeDir),
    homeDir,
    env,
    logger: options.logger,
    resolveSpawnContext: options.resolveSpawnContext,
    installCommandRunner: createPtyInstallCommandRunner({
      spawner,
      cwd: homeDir,
      env,
      shell: env.SHELL ?? '/bin/sh',
    }),
  });
}


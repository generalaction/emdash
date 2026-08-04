import { mkdir } from 'node:fs/promises';
import { createJsonFileKeyValueStore } from '@emdash/core/primitives/kv/node';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import type { AgentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import type { AutomationsContract } from '@emdash/core/runtimes/automations/api';
import { createAutomationsComponent } from '@emdash/core/runtimes/automations/node';
import type { ConversationsContract } from '@emdash/core/runtimes/conversations/api';
import { conversationsComponent } from '@emdash/core/runtimes/conversations/node';
import type { FileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { fileSearchComponent } from '@emdash/core/runtimes/file-search/node';
import type { FilesContract } from '@emdash/core/runtimes/files/api';
import { filesComponent } from '@emdash/core/runtimes/files/node';
import type { GitContract } from '@emdash/core/runtimes/git/api';
import { gitComponent, NON_INTERACTIVE_GIT_ENV } from '@emdash/core/runtimes/git/node';
import type { ResourceUsageContract } from '@emdash/core/runtimes/resource-usage/api';
import { resourceUsageComponent } from '@emdash/core/runtimes/resource-usage/node';
import type { TerminalsContract } from '@emdash/core/runtimes/terminals/api';
import { terminalsComponent } from '@emdash/core/runtimes/terminals/node';
import type { TuiAgentsContract } from '@emdash/core/runtimes/tui-agents/api';
import { createTuiAgentsComponent } from '@emdash/core/runtimes/tui-agents/node';
import type { WorkspaceHostContract } from '@emdash/core/runtimes/workspace-host/api';
import { workspaceHostComponent } from '@emdash/core/runtimes/workspace-host/node';
import { buildDescriptorFromProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import { NodeExecutionContext } from '@emdash/core/services/exec/api';
import { fsWatchComponent } from '@emdash/core/services/fs-watch/node';
import {
  CORE_DEPENDENCIES,
  createHostDependenciesComponent,
  type HostDependenciesContract,
} from '@emdash/core/services/host-dependencies/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type { ValidatePolicy } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import { createWireWorkerHost } from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { workspaceServerRuntimePaths } from '../runtime/paths';
import { workspaceWorkerPath } from './worker-paths';

export type WorkspaceServerRuntimeClients = {
  acp: ContractClient<AcpApiContract>;
  agentConfig: ContractClient<AgentConfigContract>;
  automations: ContractClient<AutomationsContract>;
  conversations: ContractClient<ConversationsContract>;
  fileSearch: ContractClient<FileSearchContract>;
  files: ContractClient<FilesContract>;
  git: ContractClient<GitContract>;
  resourceUsage: ContractClient<ResourceUsageContract>;
  terminals: ContractClient<TerminalsContract>;
  tuiAgents: ContractClient<TuiAgentsContract>;
  workspaceHost: ContractClient<WorkspaceHostContract>;
};

export type WorkspaceServerRuntimeHost = {
  runtimes: WorkspaceServerRuntimeClients;
  hostDependencies: ContractClient<HostDependenciesContract>;
};

export type CreateWorkspaceServerRuntimeHostOptions = {
  scope: Scope;
  socketPath?: string;
  env?: NodeJS.ProcessEnv;
  refreshShellEnv?: () => Promise<void>;
  validate?: ValidatePolicy;
  logger?: Logger;
};

const SESSION_IDLE_MS = 60 * 60_000;
const DETACHED_TERMINAL_GRACE_MS = 5 * 60_000;

export async function createWorkspaceServerRuntimeHost(
  options: CreateWorkspaceServerRuntimeHostOptions
): Promise<WorkspaceServerRuntimeHost> {
  const env = options.env ?? process.env;
  const GIT_RUNTIME_ENV = {
    ...env,
    ...NON_INTERACTIVE_GIT_ENV,
    LC_ALL: 'C',
    LANG: 'C',
    LANGUAGE: 'C',
  };
  const paths = workspaceServerRuntimePaths(options.socketPath);
  await Promise.all([
    mkdir(paths.stateDirectory, { recursive: true }),
    mkdir(paths.attachmentsDirectory, { recursive: true }),
  ]);

  const workerHost = createWireWorkerHost({
    scope: options.scope.child('workers'),
    processSpawner: childProcessSpawner(),
  });
  const hostDependencies = createHostDependenciesComponent({
    store: createJsonFileKeyValueStore({ path: paths.hostDependenciesStore }),
    exec: new NodeExecutionContext({ env, refreshShellEnv: options.refreshShellEnv }),
    logger: options.logger,
  }).create({
    scope: options.scope.child('host-dependencies'),
    dependencies: {},
    config: {
      hostId: 'local',
      definitions: [
        ...CORE_DEPENDENCIES,
        ...pluginRegistry.getAll().map(buildDescriptorFromProvider),
      ],
    },
    validate: options.validate,
  });

  // The conversations index depends on nothing and spawns first (spec §3.4). Default
  // supervision (restart on failure) is deliberate: a durable index should come back.
  const conversationsPromise = workerHost.spawn(conversationsComponent, {
    name: 'conversations',
    executable: workspaceWorkerPath('conversations'),
    env,
    dependencies: {},
    config: { databasePath: paths.conversationsDatabase },
    shutdownGraceMs: 3_000,
  });
  const watcherPromise = workerHost.spawn(fsWatchComponent, {
    name: 'fs-watch',
    executable: workspaceWorkerPath('fs-watch'),
    env,
    dependencies: {},
    config: {},
  });
  const terminalsPromise = workerHost.spawn(terminalsComponent, {
    name: 'terminals',
    executable: workspaceWorkerPath('terminals'),
    env,
    dependencies: {},
    config: {
      lifecycle: {
        terminal: { kind: 'while-attached', graceMs: DETACHED_TERMINAL_GRACE_MS },
        backgroundScript: { kind: 'while-attached', graceMs: DETACHED_TERMINAL_GRACE_MS },
      },
    },
  });
  const resourceUsagePromise = workerHost.spawn(resourceUsageComponent, {
    name: 'resource-usage',
    executable: workspaceWorkerPath('resource-usage'),
    env,
    dependencies: {},
    config: {},
  });
  const acpPromise = workerHost.spawn(createAcpComponent({ pluginRegistry, env }), {
    name: 'acp',
    executable: workspaceWorkerPath('acp'),
    env,
    dependencies: {
      hostDependencies: hostDependencies.client.resolver,
    },
    config: {
      attachmentsDir: paths.attachmentsDirectory,
      intentsFilePath: paths.acpIntentsFile,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: SESSION_IDLE_MS },
        connectionIdleTtlMs: 120_000,
      },
    },
  });
  const agentConfigPromise = workerHost.spawn(createAgentConfigComponent({ pluginRegistry, env }), {
    name: 'agent-config',
    executable: workspaceWorkerPath('agent-config'),
    env,
    dependencies: {
      hostDependencies: hostDependencies.client.resolver,
    },
    config: {},
  });
  const tuiAgentsPromise = workerHost.spawn(createTuiAgentsComponent({ pluginRegistry, env }), {
    name: 'tui-agents',
    executable: workspaceWorkerPath('tui-agents'),
    env,
    dependencies: {
      hostDependencies: hostDependencies.client.resolver,
    },
    config: {
      intentsFilePath: paths.tuiAgentsIntentsFile,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: SESSION_IDLE_MS },
      },
    },
  });

  const [conversations, watcher, terminals, resourceUsage, acp, agentConfig, tuiAgents] =
    await Promise.all([
      conversationsPromise,
      watcherPromise,
      terminalsPromise,
      resourceUsagePromise,
      acpPromise,
      agentConfigPromise,
      tuiAgentsPromise,
    ]);

  const filesPromise = workerHost.spawn(filesComponent, {
    name: 'files',
    executable: workspaceWorkerPath('files'),
    env,
    dependencies: { watcher },
    config: {},
  });
  const fileSearchPromise = workerHost.spawn(fileSearchComponent, {
    name: 'file-search',
    executable: workspaceWorkerPath('file-search'),
    env,
    dependencies: { watcher },
    config: {
      databasePath: paths.fileSearchDatabase,
      ...(env['EMDASH_WS_RIPGREP_PATH'] ? { ripgrepPath: env['EMDASH_WS_RIPGREP_PATH'] } : {}),
    },
  });
  const gitPromise = workerHost.spawn(gitComponent, {
    name: 'git',
    executable: workspaceWorkerPath('git'),
    env: GIT_RUNTIME_ENV,
    dependencies: {
      watcher,
      hostDependencies: hostDependencies.client.resolver,
    },
    config: { env: GIT_RUNTIME_ENV },
  });
  const workspaceHostPromise = workerHost.spawn(workspaceHostComponent, {
    name: 'workspace-host',
    executable: workspaceWorkerPath('workspace-host'),
    env,
    dependencies: { acp, terminals, tuiAgents },
    config: { stateDirectory: paths.workspaceHostStateDirectory },
    supervision: { restart: 'never' },
  });

  const [files, fileSearch, git, workspaceHost] = await Promise.all([
    filesPromise,
    fileSearchPromise,
    gitPromise,
    workspaceHostPromise,
  ]);
  const automations = await workerHost.spawn(createAutomationsComponent(), {
    name: 'automations',
    executable: workspaceWorkerPath('automations'),
    env,
    dependencies: {
      workspaceHost,
      acpSessions: acp,
      tuiSessions: tuiAgents,
    },
    config: { dbFile: paths.automationsDatabase },
    shutdownGraceMs: 3_000,
  });

  return {
    runtimes: {
      acp,
      agentConfig,
      automations,
      conversations,
      fileSearch,
      files,
      git,
      resourceUsage,
      terminals,
      tuiAgents,
      workspaceHost,
    },
    hostDependencies: hostDependencies.client,
  };
}

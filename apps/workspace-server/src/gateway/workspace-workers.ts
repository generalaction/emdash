import { mkdir } from 'node:fs/promises';
import { createJsonFileKeyValueStore } from '@emdash/core/primitives/kv/node';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { acpWorkerSpec } from '@emdash/core/runtimes/acp/node';
import type { AgentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { agentConfigWorkerSpec } from '@emdash/core/runtimes/agent-config/node';
import type { AutomationsContract } from '@emdash/core/runtimes/automations/api';
import { workspaceCreationAdmissionContract } from '@emdash/core/runtimes/automations/api';
import { automationsWorkerSpec } from '@emdash/core/runtimes/automations/node';
import type { ConversationsContract } from '@emdash/core/runtimes/conversations/api';
import { conversationsWorkerSpec } from '@emdash/core/runtimes/conversations/node';
import type { FileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { fileSearchWorkerSpec } from '@emdash/core/runtimes/file-search/node';
import type { FilesContract } from '@emdash/core/runtimes/files/api';
import { filesWorkerSpec } from '@emdash/core/runtimes/files/node';
import type { GitContract } from '@emdash/core/runtimes/git/api';
import { gitWorkerSpec } from '@emdash/core/runtimes/git/node';
import type { ResourceUsageContract } from '@emdash/core/runtimes/resource-usage/api';
import { resourceUsageWorkerSpec } from '@emdash/core/runtimes/resource-usage/node';
import type { TerminalsContract } from '@emdash/core/runtimes/terminals/api';
import { terminalsWorkerSpec } from '@emdash/core/runtimes/terminals/node';
import type { TuiAgentsContract } from '@emdash/core/runtimes/tui-agents/api';
import { tuiAgentsWorkerSpec } from '@emdash/core/runtimes/tui-agents/node';
import type { WorkspaceHostContract } from '@emdash/core/runtimes/workspace-host/api';
import { workspaceHostWorkerSpec } from '@emdash/core/runtimes/workspace-host/node';
import type { WorkspaceRegistryContract } from '@emdash/core/runtimes/workspace-registry/api';
import { workspaceRegistryWorkerSpec } from '@emdash/core/runtimes/workspace-registry/node';
import { buildDescriptorFromProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import { NodeExecutionContext } from '@emdash/core/services/exec/api';
import { fsWatchWorkerSpec } from '@emdash/core/services/fs-watch/node';
import {
  CORE_DEPENDENCIES,
  createHostDependenciesComponent,
  type HostDependenciesContract,
} from '@emdash/core/services/host-dependencies/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { ok } from '@emdash/shared/result';
import type { ValidatePolicy } from '@emdash/wire';
import { createController, type ContractClient } from '@emdash/wire/api';
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
  workspaceRegistry: ContractClient<WorkspaceRegistryContract>;
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

const DETACHED_TERMINAL_GRACE_MS = 5 * 60_000;

export async function createWorkspaceServerRuntimeHost(
  options: CreateWorkspaceServerRuntimeHostOptions
): Promise<WorkspaceServerRuntimeHost> {
  const env = options.env ?? process.env;
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

  const conversationsPromise = workerHost.spawn(
    ...conversationsWorkerSpec({
      executable: workspaceWorkerPath('conversations'),
      env,
      databasePath: paths.conversationsDatabase,
    })
  );
  const watcherPromise = workerHost.spawn(
    ...fsWatchWorkerSpec({ executable: workspaceWorkerPath('fs-watch'), env })
  );
  const terminalsPromise = workerHost.spawn(
    ...terminalsWorkerSpec({
      executable: workspaceWorkerPath('terminals'),
      env,
      lifecycle: {
        terminal: { kind: 'while-attached', graceMs: DETACHED_TERMINAL_GRACE_MS },
        backgroundScript: { kind: 'while-attached', graceMs: DETACHED_TERMINAL_GRACE_MS },
      },
    })
  );
  const resourceUsagePromise = workerHost.spawn(
    ...resourceUsageWorkerSpec({
      executable: workspaceWorkerPath('resource-usage'),
      env,
    })
  );
  const acpPromise = conversationsPromise.then((conversations) =>
    workerHost.spawn(
      ...acpWorkerSpec({
        pluginRegistry,
        executable: workspaceWorkerPath('acp'),
        env,
        dependencies: {
          hostDependencies: hostDependencies.client.resolver,
          conversations,
        },
        attachmentsDir: paths.attachmentsDirectory,
        intentsFilePath: paths.acpIntentsFile,
      })
    )
  );
  const agentConfigPromise = workerHost.spawn(
    ...agentConfigWorkerSpec({
      pluginRegistry,
      executable: workspaceWorkerPath('agent-config'),
      env,
      dependencies: {
        hostDependencies: hostDependencies.client.resolver,
      },
    })
  );
  const tuiAgentsPromise = conversationsPromise.then((conversations) =>
    workerHost.spawn(
      ...tuiAgentsWorkerSpec({
        pluginRegistry,
        executable: workspaceWorkerPath('tui-agents'),
        env,
        dependencies: {
          hostDependencies: hostDependencies.client.resolver,
          conversations,
        },
        intentsFilePath: paths.tuiAgentsIntentsFile,
      })
    )
  );

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

  const filesPromise = workerHost.spawn(
    ...filesWorkerSpec({
      executable: workspaceWorkerPath('files'),
      env,
      dependencies: { watcher },
    })
  );
  const fileSearchPromise = workerHost.spawn(
    ...fileSearchWorkerSpec({
      executable: workspaceWorkerPath('file-search'),
      env,
      dependencies: { watcher },
      databasePath: paths.fileSearchDatabase,
      ripgrepPath: env['EMDASH_WS_RIPGREP_PATH'],
    })
  );
  const gitPromise = workerHost.spawn(
    ...gitWorkerSpec({
      executable: workspaceWorkerPath('git'),
      env,
      dependencies: {
        watcher,
        hostDependencies: hostDependencies.client.resolver,
      },
    })
  );
  const workspaceHostPromise = workerHost.spawn(
    ...workspaceHostWorkerSpec({
      executable: workspaceWorkerPath('workspace-host'),
      env,
      dependencies: { acp, terminals, tuiAgents },
      stateDirectory: paths.workspaceHostStateDirectory,
    })
  );
  const workspaceRegistryPromise = workerHost.spawn(
    ...workspaceRegistryWorkerSpec({
      executable: workspaceWorkerPath('workspace-registry'),
      env,
      dependencies: { watcher, acp, terminals, tuiAgents },
      databasePath: paths.workspaceRegistryDatabase,
    })
  );

  const [files, fileSearch, git, workspaceHost, workspaceRegistry] = await Promise.all([
    filesPromise,
    fileSearchPromise,
    gitPromise,
    workspaceHostPromise,
    workspaceRegistryPromise,
  ]);
  const automations = await workerHost.spawn(
    ...automationsWorkerSpec({
      executable: workspaceWorkerPath('automations'),
      env,
      dependencies: {
        workspaceHost,
        workspaceRegistry,
        // Deletion tombstones are client-plane data (ADR 0006): the workspace server
        // has no desktop mirror to consult, so host-resident runs admit
        // unconditionally; identity-keyed sweeps keep recreation safe regardless.
        creationAdmission: createController(workspaceCreationAdmissionContract, {
          checkWorktreeCreation: async () => ok(undefined),
        }),
        acpSessions: acp,
        tuiSessions: tuiAgents,
        conversationIndex: conversations,
      },
      dbFile: paths.automationsDatabase,
    })
  );

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
      workspaceRegistry,
    },
    hostDependencies: hostDependencies.client,
  };
}

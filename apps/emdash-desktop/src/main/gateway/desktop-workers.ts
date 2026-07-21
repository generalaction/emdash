import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import type { AgentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import type { AutomationsContract } from '@emdash/core/runtimes/automations/api';
import { createAutomationsComponent } from '@emdash/core/runtimes/automations/node';
import type { FileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { fileSearchComponent } from '@emdash/core/runtimes/file-search/node';
import type { FilesContract } from '@emdash/core/runtimes/files/api';
import { filesComponent } from '@emdash/core/runtimes/files/node';
import type { GitContract } from '@emdash/core/runtimes/git/api';
import { gitComponent, NON_INTERACTIVE_GIT_ENV } from '@emdash/core/runtimes/git/node';
import type { TerminalsContract } from '@emdash/core/runtimes/terminals/api';
import { terminalsComponent } from '@emdash/core/runtimes/terminals/node';
import type { TuiAgentsContract } from '@emdash/core/runtimes/tui-agents/api';
import { createTuiAgentsComponent } from '@emdash/core/runtimes/tui-agents/node';
import type { WorkspaceContract } from '@emdash/core/runtimes/workspace/api';
import { workspaceComponent } from '@emdash/core/runtimes/workspace/node';
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
import type { ContractClient } from '@emdash/wire/api';
import { createWireWorkerHost, type WireWorker } from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { app } from 'electron';
import { automationRuntimePaths } from '@core/features/automations/node/runtime-paths';
import { GitHubApiAuthService } from '@core/features/github/api/node/services/github-api-auth-service';
import { githubApiBaseUrlForHost } from '@core/features/github/api/node/services/github-api-base-url';
import { mementoSweepPolicies } from '@core/manifests/shared/memento-catalog';
import type { MementosWireContract } from '@core/primitives/mementos/api';
import { mementosComponent } from '@core/services/mementos/node';
import type { PullRequestsContract } from '@core/services/pull-requests/api';
import { pullRequestsComponent } from '@core/services/pull-requests/node';
import { createPullRequestsGitHubAuthController } from '@core/services/pull-requests/node/pull-requests-auth';
import { resolveFileSearchDatabasePath } from '@main/core/file-search/database-path';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { sessionIntentFilePaths } from '@main/core/runtime/session-intent-stores';
import { getGitExecutable } from '@main/core/utils/exec';
import { desktopKeyValueStore } from '@main/db/kv';
import { resolveDatabasePath } from '@main/db/path';
import { log } from '@main/lib/logger';
import { desktopWorkerPath } from './worker-paths';

export type AcpRuntimeClient = ContractClient<AcpApiContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;
export type AutomationsRuntimeClient = ContractClient<AutomationsContract>;
export type FileSearchRuntimeClient = ContractClient<FileSearchContract>;
export type FilesRuntimeClient = ContractClient<FilesContract>;
export type GitRuntimeClient = ContractClient<GitContract>;
export type HostDependenciesClient = ContractClient<HostDependenciesContract>;
export type MementosRuntimeClient = ContractClient<MementosWireContract>;
export type PullRequestsRuntimeClient = ContractClient<PullRequestsContract>;
export type TerminalsRuntimeClient = ContractClient<TerminalsContract>;
export type TuiAgentsRuntimeClient = ContractClient<TuiAgentsContract>;
export type WorkspaceRuntimeClient = ContractClient<WorkspaceContract>;

export type DesktopRuntimeClients = {
  readonly acp: AcpRuntimeClient;
  readonly agentConfig: AgentConfigRuntimeClient;
  readonly automations: AutomationsRuntimeClient;
  readonly fileSearch: FileSearchRuntimeClient;
  readonly files: FilesRuntimeClient;
  readonly git: GitRuntimeClient;
  readonly hostDependencies: HostDependenciesClient;
  readonly mementos: MementosRuntimeClient;
  readonly pullRequests: PullRequestsRuntimeClient;
  readonly terminals: TerminalsRuntimeClient;
  readonly tuiAgents: TuiAgentsRuntimeClient;
  readonly workspace: WorkspaceRuntimeClient;
};

export type DesktopRuntimeWorkers = {
  readonly acp: WireWorker<AcpApiContract>;
  readonly tuiAgents: WireWorker<TuiAgentsContract>;
};

export type DesktopWorkersHandle = {
  readonly clients: DesktopRuntimeClients;
  readonly workers: DesktopRuntimeWorkers;
  dispose(): Promise<void>;
};

export type StartDesktopWorkersDeps = {
  readonly scope: Scope;
  getLocalProjectSettings(): Promise<{ writeAgentConfigToGitIgnore?: boolean }>;
};

const GIT_RUNTIME_ENV = {
  ...process.env,
  ...NON_INTERACTIVE_GIT_ENV,
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
};
const SESSION_IDLE_MS = 60 * 60_000;

export async function startDesktopWorkers(
  deps: StartDesktopWorkersDeps
): Promise<DesktopWorkersHandle> {
  const workerScope = deps.scope.child('wire-workers');
  const host = createWireWorkerHost({
    scope: workerScope,
    processSpawner: childProcessSpawner(),
    logger: log,
  });
  try {
    return await startDesktopWorkersWithHost(deps, workerScope, host);
  } catch (error) {
    await workerScope.dispose(error);
    throw error;
  }
}

async function startDesktopWorkersWithHost(
  deps: StartDesktopWorkersDeps,
  workerScope: Scope,
  host: ReturnType<typeof createWireWorkerHost>
): Promise<DesktopWorkersHandle> {
  const hostDependencies = createHostDependenciesComponent({
    store: desktopKeyValueStore,
    exec: new NodeExecutionContext({ env: process.env }),
  }).create({
    scope: workerScope,
    dependencies: {},
    config: {
      hostId: 'local',
      definitions: [
        ...CORE_DEPENDENCIES,
        ...pluginRegistry.getAll().map(buildDescriptorFromProvider),
      ],
    },
  });
  const fsWatchWorker = host.create(fsWatchComponent, {
    name: 'fs-watch',
    executable: desktopWorkerPath('fs-watch'),
    env: process.env,
    dependencies: {},
    config: {},
  });
  const acpWorker = host.create(createAcpComponent({ pluginRegistry, logger: log }), {
    name: 'acp',
    executable: desktopWorkerPath('acp'),
    env: process.env,
    dependencies: {
      hostDependencies: hostDependencies.client.resolver,
    },
    config: {
      attachmentsDir: join(app.getPath('userData'), 'acp-attachments'),
      intentsFilePath: sessionIntentFilePaths().acp,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: SESSION_IDLE_MS },
        connectionIdleTtlMs: 120_000,
      },
    },
  });
  const agentConfigWorker = host.create(
    createAgentConfigComponent({ pluginRegistry, logger: log }),
    {
      name: 'agent-config',
      executable: desktopWorkerPath('agent-config'),
      env: process.env,
      dependencies: {
        hostDependencies: hostDependencies.client.resolver,
      },
      config: {},
    }
  );
  const mementosWorker = host.create(mementosComponent, {
    name: 'mementos',
    executable: desktopWorkerPath('mementos'),
    env: process.env,
    dependencies: {},
    config: {
      databasePath: join(app.getPath('userData'), 'mementos.db'),
      sweepPolicies: mementoSweepPolicies,
    },
  });
  const pullRequestsWorker = host.create(pullRequestsComponent, {
    name: 'pull-requests',
    executable: desktopWorkerPath('pull-requests'),
    env: process.env,
    dependencies: {
      githubAuth: createPullRequestsGitHubAuthController(
        new GitHubApiAuthService(providerAccountRegistry),
        githubApiBaseUrlForHost
      ),
    },
    config: {
      databasePath: join(app.getPath('userData'), 'pull-requests.db'),
      incrementalIntervalMs: 5 * 60_000,
    },
  });
  const terminalsWorker = host.create(terminalsComponent, {
    name: 'terminals',
    executable: desktopWorkerPath('terminals'),
    env: process.env,
    dependencies: {},
    config: {
      lifecycle: {
        terminal: { kind: 'always' },
        backgroundScript: { kind: 'always' },
      },
    },
  });

  const watcherReady = fsWatchWorker.ready();
  const acpReady = acpWorker.ready();
  const agentConfigReady = agentConfigWorker.ready();
  const mementosReady = mementosWorker.ready();
  const pullRequestsReady = pullRequestsWorker.ready();
  const terminalsReady = terminalsWorker.ready();
  const filesReady = watcherReady.then(async (watcher) => {
    const worker = host.create(filesComponent, {
      name: 'files',
      executable: desktopWorkerPath('files'),
      env: process.env,
      dependencies: { watcher },
      config: {},
    });
    return await worker.ready();
  });
  const fileSearchReady = watcherReady.then(async (watcher) => {
    const worker = host.create(fileSearchComponent, {
      name: 'file-search',
      executable: desktopWorkerPath('file-search'),
      env: process.env,
      dependencies: { watcher },
      config: { databasePath: resolveFileSearchDatabasePath() },
    });
    return await worker.ready();
  });
  const gitReady = watcherReady.then(async (watcher) => {
    const worker = host.create(gitComponent, {
      name: 'git',
      executable: desktopWorkerPath('git'),
      env: GIT_RUNTIME_ENV,
      dependencies: {
        watcher,
        hostDependencies: hostDependencies.client.resolver,
      },
      config: {
        executable: getGitExecutable(),
        env: GIT_RUNTIME_ENV,
      },
    });
    return await worker.ready();
  });
  const tuiAgentsReady = deps.getLocalProjectSettings().then(async (localProjectSettings) => {
    const worker = host.create(createTuiAgentsComponent({ pluginRegistry, logger: log }), {
      name: 'tui-agents',
      executable: desktopWorkerPath('tui-agents'),
      env: process.env,
      dependencies: {
        hostDependencies: hostDependencies.client.resolver,
      },
      config: {
        intentsFilePath: sessionIntentFilePaths().tuiAgents,
        lifecycle: {
          session: { kind: 'idle-after', outputMs: SESSION_IDLE_MS },
        },
        hookInstall: {
          writeGitIgnoreEntries: localProjectSettings.writeAgentConfigToGitIgnore ?? true,
        },
      },
    });
    return { client: await worker.ready(), worker };
  });
  const workspaceReady = Promise.all([terminalsReady, watcherReady]).then(
    async ([terminals, watcher]) => {
      const worker = host.create(workspaceComponent, {
        name: 'workspace',
        executable: desktopWorkerPath('workspace'),
        env: process.env,
        dependencies: {
          terminals,
          watcher,
        },
        config: {},
        // Consumer leases and active operation ownership are currently process-local.
        supervision: { restart: 'never' },
      });
      return await worker.ready();
    }
  );
  const automationsReady = Promise.all([workspaceReady, acpReady, tuiAgentsReady]).then(
    async ([workspace, acp, tuiAgents]) => {
      const paths = automationRuntimePaths(resolveDatabasePath());
      mkdirSync(paths.stateDirectory, { recursive: true });
      const worker = host.create(createAutomationsComponent(), {
        name: 'automations',
        executable: desktopWorkerPath('automations'),
        env: process.env,
        dependencies: {
          workspace,
          acpSessions: acp,
          tuiSessions: tuiAgents.client,
        },
        config: { dbFile: paths.dbFile },
        shutdownGraceMs: 3_000,
      });
      return { client: await worker.ready(), worker };
    }
  );

  const [
    acp,
    agentConfig,
    automationsResult,
    fileSearch,
    files,
    git,
    mementos,
    pullRequests,
    terminals,
    tuiAgentsResult,
    workspace,
  ] = await Promise.all([
    acpReady,
    agentConfigReady,
    automationsReady,
    fileSearchReady,
    filesReady,
    gitReady,
    mementosReady,
    pullRequestsReady,
    terminalsReady,
    tuiAgentsReady,
    workspaceReady,
  ]);
  const automations = automationsResult.client;
  const tuiAgents = tuiAgentsResult.client;

  let disposePromise: Promise<void> | undefined;
  return {
    clients: {
      acp,
      agentConfig,
      automations,
      fileSearch,
      files,
      git,
      hostDependencies: hostDependencies.client,
      mementos,
      pullRequests,
      terminals,
      tuiAgents,
      workspace,
    },
    workers: {
      acp: acpWorker,
      tuiAgents: tuiAgentsResult.worker,
    },
    dispose() {
      disposePromise ??= (async () => {
        await automationsResult.worker.stop();
        await host.dispose();
      })();
      return disposePromise;
    },
  };
}

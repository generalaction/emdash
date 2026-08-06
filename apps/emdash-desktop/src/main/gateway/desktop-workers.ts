import { join } from 'node:path';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { acpWorkerSpec } from '@emdash/core/runtimes/acp/node';
import type { AgentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { agentConfigWorkerSpec } from '@emdash/core/runtimes/agent-config/node';
import type { AutomationsContract } from '@emdash/core/runtimes/automations/api';
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
import type { ContractClient } from '@emdash/wire/rpc';
import {
  createVitalsCollectingSpawner,
  createWireWorkerHost,
  type WireWorker,
} from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { app } from 'electron';
import { createAutomationCreationAdmissionController } from '@core/features/automations/node/creation-admission';
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
import { getAppDb } from '@main/db/instance';
import { desktopKeyValueStore } from '@main/db/kv';
import { resolveDatabasePath } from '@main/db/path';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { refreshUserEnv } from '@main/lib/userEnv';
import { desktopWorkerPath } from './worker-paths';

export type AcpRuntimeClient = ContractClient<AcpApiContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;
export type AutomationsRuntimeClient = ContractClient<AutomationsContract>;
export type ConversationsRuntimeClient = ContractClient<ConversationsContract>;
export type FileSearchRuntimeClient = ContractClient<FileSearchContract>;
export type FilesRuntimeClient = ContractClient<FilesContract>;
export type GitRuntimeClient = ContractClient<GitContract>;
export type ResourceUsageRuntimeClient = ContractClient<ResourceUsageContract>;
export type HostDependenciesClient = ContractClient<HostDependenciesContract>;
export type MementosRuntimeClient = ContractClient<MementosWireContract>;
export type PullRequestsRuntimeClient = ContractClient<PullRequestsContract>;
export type TerminalsRuntimeClient = ContractClient<TerminalsContract>;
export type TuiAgentsRuntimeClient = ContractClient<TuiAgentsContract>;
export type WorkspaceHostRuntimeClient = ContractClient<WorkspaceHostContract>;
export type WorkspaceRegistryRuntimeClient = ContractClient<WorkspaceRegistryContract>;

export type DesktopRuntimeClients = {
  readonly acp: AcpRuntimeClient;
  readonly agentConfig: AgentConfigRuntimeClient;
  readonly automations: AutomationsRuntimeClient;
  readonly conversations: ConversationsRuntimeClient;
  readonly fileSearch: FileSearchRuntimeClient;
  readonly files: FilesRuntimeClient;
  readonly git: GitRuntimeClient;
  readonly hostDependencies: HostDependenciesClient;
  readonly mementos: MementosRuntimeClient;
  readonly pullRequests: PullRequestsRuntimeClient;
  readonly resourceUsage: ResourceUsageRuntimeClient;
  readonly terminals: TerminalsRuntimeClient;
  readonly tuiAgents: TuiAgentsRuntimeClient;
  readonly workspaceHost: WorkspaceHostRuntimeClient;
  readonly workspaceRegistry: WorkspaceRegistryRuntimeClient;
};

export type DesktopRuntimeWorkers = {
  readonly acp: WireWorker<AcpApiContract>;
  readonly tuiAgents: WireWorker<TuiAgentsContract>;
};

export type DesktopWorkersHandle = {
  readonly clients: DesktopRuntimeClients;
  readonly workers: DesktopRuntimeWorkers;
  /**
   * Activate per-worker vitals self-sampling (telemetry-sampled sessions
   * only). Reaches every live worker and any worker spawned later.
   */
  startVitalsSampling(intervalMs: number): void;
  /** Toggle verbose per-spawn logging in every live and future worker. */
  setSpawnLogging(enabled: boolean): void;
  dispose(): Promise<void>;
};

export type StartDesktopWorkersDeps = {
  readonly scope: Scope;
  getFilesSettings(): Promise<{ watcherExclude: string[] }>;
};

export async function startDesktopWorkers(
  deps: StartDesktopWorkersDeps
): Promise<DesktopWorkersHandle> {
  const workerScope = deps.scope.child('wire-workers');
  const vitalsSpawner = createVitalsCollectingSpawner(childProcessSpawner(), {
    onReport: (workerName, vitals) => {
      telemetryService.capture('perf_vitals', { process_name: `worker_${workerName}`, ...vitals });
    },
  });
  const host = createWireWorkerHost({
    scope: workerScope,
    processSpawner: vitalsSpawner,
    logger: log,
  });
  try {
    const handle = await startDesktopWorkersWithHost(deps, workerScope, host);
    return {
      ...handle,
      startVitalsSampling: (intervalMs) => vitalsSpawner.startSampling(intervalMs),
      setSpawnLogging: (enabled) => vitalsSpawner.setSpawnLogging(enabled),
    };
  } catch (error) {
    await workerScope.dispose(error);
    throw error;
  }
}

async function startDesktopWorkersWithHost(
  deps: StartDesktopWorkersDeps,
  workerScope: Scope,
  host: ReturnType<typeof createWireWorkerHost>
): Promise<Omit<DesktopWorkersHandle, 'startVitalsSampling' | 'setSpawnLogging'>> {
  const hostDependencies = createHostDependenciesComponent({
    store: desktopKeyValueStore,
    exec: new NodeExecutionContext({ env: process.env, refreshShellEnv: refreshUserEnv }),
    logger: log,
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
  const fsWatchWorker = host.create(
    ...fsWatchWorkerSpec({ executable: desktopWorkerPath('fs-watch'), env: process.env })
  );
  const conversationsWorker = host.create(
    ...conversationsWorkerSpec({
      executable: desktopWorkerPath('conversations'),
      env: process.env,
      databasePath: join(app.getPath('userData'), 'conversations.db'),
    })
  );
  const conversationsReady = conversationsWorker.ready();
  const acpStart = conversationsReady.then(async (conversations) => {
    const worker = host.create(
      ...acpWorkerSpec({
        pluginRegistry,
        logger: log,
        executable: desktopWorkerPath('acp'),
        env: process.env,
        dependencies: {
          hostDependencies: hostDependencies.client.resolver,
          conversations,
        },
        attachmentsDir: join(app.getPath('userData'), 'acp-attachments'),
        intentsFilePath: sessionIntentFilePaths().acp,
      })
    );
    return { client: await worker.ready(), worker };
  });
  const agentConfigWorker = host.create(
    ...agentConfigWorkerSpec({
      pluginRegistry,
      logger: log,
      executable: desktopWorkerPath('agent-config'),
      env: process.env,
      dependencies: {
        hostDependencies: hostDependencies.client.resolver,
      },
    })
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
  const terminalsWorker = host.create(
    ...terminalsWorkerSpec({
      executable: desktopWorkerPath('terminals'),
      env: process.env,
      lifecycle: {
        terminal: { kind: 'always' },
        backgroundScript: { kind: 'always' },
      },
    })
  );
  const resourceUsageWorker = host.create(
    ...resourceUsageWorkerSpec({
      executable: desktopWorkerPath('resource-usage'),
      env: process.env,
    })
  );

  const watcherReady = fsWatchWorker.ready();
  const acpReady = acpStart.then((result) => result.client);
  const agentConfigReady = agentConfigWorker.ready();
  const mementosReady = mementosWorker.ready();
  const pullRequestsReady = pullRequestsWorker.ready();
  const resourceUsageReady = resourceUsageWorker.ready();
  const terminalsReady = terminalsWorker.ready();
  const filesReady = watcherReady.then(async (watcher) => {
    const filesSettings = await deps.getFilesSettings();
    const worker = host.create(
      ...filesWorkerSpec({
        executable: desktopWorkerPath('files'),
        env: process.env,
        dependencies: { watcher },
        watchIgnore: filesSettings.watcherExclude,
      })
    );
    return await worker.ready();
  });
  const fileSearchReady = watcherReady.then(async (watcher) => {
    const worker = host.create(
      ...fileSearchWorkerSpec({
        executable: desktopWorkerPath('file-search'),
        env: process.env,
        dependencies: { watcher },
        databasePath: resolveFileSearchDatabasePath(),
      })
    );
    return await worker.ready();
  });
  const gitReady = watcherReady.then(async (watcher) => {
    const worker = host.create(
      ...gitWorkerSpec({
        executable: desktopWorkerPath('git'),
        env: process.env,
        dependencies: {
          watcher,
          hostDependencies: hostDependencies.client.resolver,
        },
        gitExecutable: getGitExecutable(),
      })
    );
    return await worker.ready();
  });
  const tuiAgentsReady = conversationsReady.then(async (conversations) => {
    const worker = host.create(
      ...tuiAgentsWorkerSpec({
        pluginRegistry,
        logger: log,
        executable: desktopWorkerPath('tui-agents'),
        env: process.env,
        dependencies: {
          hostDependencies: hostDependencies.client.resolver,
          conversations,
        },
        intentsFilePath: sessionIntentFilePaths().tuiAgents,
      })
    );
    return { client: await worker.ready(), worker };
  });
  const workspaceRegistryReady = Promise.all([
    watcherReady,
    acpReady,
    terminalsReady,
    tuiAgentsReady,
  ]).then(async ([watcher, acp, terminals, tuiAgents]) => {
    const worker = host.create(
      ...workspaceRegistryWorkerSpec({
        executable: desktopWorkerPath('workspace-registry'),
        env: process.env,
        dependencies: { watcher, acp, terminals, tuiAgents: tuiAgents.client },
        databasePath: join(app.getPath('userData'), 'workspace-registry.db'),
      })
    );
    return await worker.ready();
  });
  const workspaceHostReady = Promise.all([acpReady, terminalsReady, tuiAgentsReady]).then(
    async ([acp, terminals, tuiAgents]) => {
      const worker = host.create(
        ...workspaceHostWorkerSpec({
          executable: desktopWorkerPath('workspace-host'),
          env: process.env,
          dependencies: {
            acp,
            terminals,
            tuiAgents: tuiAgents.client,
          },
          stateDirectory: join(app.getPath('userData'), 'workspace-host'),
        })
      );
      return await worker.ready();
    }
  );
  const automationsReady = Promise.all([
    workspaceHostReady,
    workspaceRegistryReady,
    acpReady,
    tuiAgentsReady,
    conversationsReady,
  ]).then(async ([workspaceHost, workspaceRegistry, acp, tuiAgents, conversationsClient]) => {
    const paths = automationRuntimePaths(resolveDatabasePath());
    const worker = host.create(
      ...automationsWorkerSpec({
        executable: desktopWorkerPath('automations'),
        env: process.env,
        dependencies: {
          workspaceHost,
          workspaceRegistry,
          // Creation admission is a desktop-mirror data check (ADR 0006): tombstones
          // live in the app db, so the main process answers for the worker.
          creationAdmission: createAutomationCreationAdmissionController(getAppDb),
          acpSessions: acp,
          tuiSessions: tuiAgents.client,
          conversationIndex: conversationsClient,
        },
        dbFile: paths.dbFile,
      })
    );
    return { client: await worker.ready(), worker };
  });

  const [
    acp,
    agentConfig,
    automationsResult,
    conversations,
    fileSearch,
    files,
    git,
    mementos,
    pullRequests,
    resourceUsage,
    terminals,
    tuiAgentsResult,
    workspaceHost,
    workspaceRegistry,
  ] = await Promise.all([
    acpReady,
    agentConfigReady,
    automationsReady,
    conversationsReady,
    fileSearchReady,
    filesReady,
    gitReady,
    mementosReady,
    pullRequestsReady,
    resourceUsageReady,
    terminalsReady,
    tuiAgentsReady,
    workspaceHostReady,
    workspaceRegistryReady,
  ]);
  const automations = automationsResult.client;
  const tuiAgents = tuiAgentsResult.client;

  let disposePromise: Promise<void> | undefined;
  return {
    clients: {
      acp,
      agentConfig,
      automations,
      conversations,
      fileSearch,
      files,
      git,
      hostDependencies: hostDependencies.client,
      mementos,
      pullRequests,
      resourceUsage,
      terminals,
      tuiAgents,
      workspaceHost,
      workspaceRegistry,
    },
    workers: {
      acp: (await acpStart).worker,
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

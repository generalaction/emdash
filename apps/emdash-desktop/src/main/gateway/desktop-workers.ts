import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import { type AgentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import type { AutomationsContract } from '@emdash/core/runtimes/automations/api';
import { createAutomationsComponent } from '@emdash/core/runtimes/automations/node';
import { type FileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { fileSearchComponent } from '@emdash/core/runtimes/file-search/node';
import type { FilesContract } from '@emdash/core/runtimes/files/api';
import { filesComponent } from '@emdash/core/runtimes/files/node';
import type { GitContract } from '@emdash/core/runtimes/git/api';
import { gitComponent } from '@emdash/core/runtimes/git/node';
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
import { type ContractClient } from '@emdash/wire/api';
import { createWireWorkerHost, type WireWorker } from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { eq } from 'drizzle-orm';
import { app } from 'electron';
import { conversationWireEvents } from '@core/features/conversations/node';
import { mementoSweepPolicies } from '@core/manifests/memento-catalog';
import type { MementosWireContract } from '@core/primitives/mementos/api';
import { mementosComponent } from '@core/services/mementos/node';
import { pullRequestsGitHubAuthController } from '@core/services/pull-requests/node/pull-requests-auth';
import { appScope } from '@main/bootstrap/app-scope';
import { automationRuntimePaths } from '@main/core/automations/runtime-paths';
import { setConversationModeId } from '@main/core/conversations/set-mode-id';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { NON_INTERACTIVE_GIT_ENV } from '@main/core/execution-context/non-interactive-git-env';
import { resolveFileSearchDatabasePath } from '@main/core/file-search/database-path';
import { sessionIntentFilePaths } from '@main/core/runtime/session-intent-stores';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getGitExecutable } from '@main/core/utils/exec';
import { workspaceRuntimePaths } from '@main/core/workspaces/runtime/workspace-runtime-paths';
import { db } from '@main/db/client';
import { desktopKeyValueStore } from '@main/db/kv';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { PullRequestsContract } from '@root/src/core/services/pull-requests/api';
import { pullRequestsComponent } from '@root/src/core/services/pull-requests/node';
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

const workerScope = appScope.child('wire-workers');
const host = createWireWorkerHost({
  scope: workerScope,
  processSpawner: childProcessSpawner(),
  logger: log,
});

const acpComponent = createAcpComponent({ pluginRegistry, logger: log });
const agentConfigComponent = createAgentConfigComponent({ pluginRegistry, logger: log });
const automationsComponent = createAutomationsComponent();
const tuiAgentsComponent = createTuiAgentsComponent({ pluginRegistry, logger: log });
const hostDependenciesComponent = createHostDependenciesComponent({
  store: desktopKeyValueStore,
  exec: new NodeExecutionContext({ env: process.env }),
});
const GIT_RUNTIME_ENV = {
  ...process.env,
  ...NON_INTERACTIVE_GIT_ENV,
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
};
const SESSION_IDLE_MS = 60 * 60_000;

const fsWatchWorker = host.create(fsWatchComponent, {
  name: 'fs-watch',
  executable: desktopWorkerPath('fs-watch'),
  env: process.env,
  dependencies: {},
  config: {},
});

const hostDependencies = hostDependenciesComponent.create({
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

export const hostDependenciesClient: HostDependenciesClient = hostDependencies.client;

export const acpWorker = host.create(acpComponent, {
  name: 'acp',
  executable: desktopWorkerPath('acp'),
  env: process.env,
  dependencies: {
    hostDependencies: hostDependencies.client.resolver,
  },
  config: {
    attachmentsDir: join(app?.getPath?.('userData') ?? process.cwd(), 'acp-attachments'),
    intentsFilePath: sessionIntentFilePaths().acp,
    lifecycle: {
      session: { kind: 'idle-after', outputMs: SESSION_IDLE_MS },
      connectionIdleTtlMs: 120_000,
    },
  },
});

let acpClientPromise: Promise<AcpRuntimeClient> | undefined;

export const agentConfigWorker = host.create(agentConfigComponent, {
  name: 'agent-config',
  executable: desktopWorkerPath('agent-config'),
  env: process.env,
  dependencies: {
    hostDependencies: hostDependencies.client.resolver,
  },
  config: {},
});

let agentConfigClientPromise: Promise<AgentConfigRuntimeClient> | undefined;

let automationsWorker: WireWorker<AutomationsContract> | undefined;
let automationsClientPromise: Promise<AutomationsRuntimeClient> | undefined;

let fileSearchWorker: WireWorker<FileSearchContract> | undefined;
let fileSearchClientPromise: Promise<FileSearchRuntimeClient> | undefined;

let filesWorker: WireWorker<FilesContract> | undefined;
let filesClientPromise: Promise<FilesRuntimeClient> | undefined;

let gitWorker: WireWorker<GitContract> | undefined;
let gitClientPromise: Promise<GitRuntimeClient> | undefined;

let mementosWorker: WireWorker<MementosWireContract> | undefined;
let mementosClientPromise: Promise<MementosRuntimeClient> | undefined;

let pullRequestsWorker: WireWorker<PullRequestsContract> | undefined;
let pullRequestsClientPromise: Promise<PullRequestsRuntimeClient> | undefined;

let terminalsWorker: WireWorker<TerminalsContract> | undefined;
let terminalsClientPromise: Promise<TerminalsRuntimeClient> | undefined;

export let tuiAgentsWorker: WireWorker<TuiAgentsContract> | undefined;
let tuiAgentsClientPromise: Promise<TuiAgentsRuntimeClient> | undefined;

let workspaceWorker: WireWorker<WorkspaceContract> | undefined;
let workspaceClientPromise: Promise<WorkspaceRuntimeClient> | undefined;

export async function ensureFilesWorkerReady(): Promise<void> {
  await getFilesRuntimeClient();
}

export async function ensureFileSearchWorkerReady(): Promise<void> {
  await getFileSearchRuntimeClient();
}

export async function ensureGitWorkerReady(): Promise<void> {
  await getGitRuntimeClient();
}

export async function ensureMementosWorkerReady(): Promise<void> {
  await getMementosRuntimeClient();
}

export async function ensureTuiAgentsWorkerReady(): Promise<void> {
  await getTuiAgentsRuntimeClient();
}

export function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  acpClientPromise ??= acpWorker.ready().then(withSessionIdPersistence).then(withModePersistence);
  return acpClientPromise;
}

export function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeClient> {
  agentConfigClientPromise ??= agentConfigWorker.ready();
  return agentConfigClientPromise;
}

export function getAutomationsRuntimeClient(): Promise<AutomationsRuntimeClient> {
  automationsClientPromise ??= createAutomationsRuntimeClient();
  return automationsClientPromise;
}

export function getFileSearchRuntimeClient(): Promise<FileSearchRuntimeClient> {
  fileSearchClientPromise ??= createFileSearchRuntimeClient();
  return fileSearchClientPromise;
}

export function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  filesClientPromise ??= createFilesRuntimeClient();
  return filesClientPromise;
}

export function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  gitClientPromise ??= createGitRuntimeClient();
  return gitClientPromise;
}

export function getMementosRuntimeClient(): Promise<MementosRuntimeClient> {
  mementosClientPromise ??= createMementosRuntimeClient();
  return mementosClientPromise;
}

export function getPullRequestsRuntimeClient(): Promise<PullRequestsRuntimeClient> {
  pullRequestsClientPromise ??= createPullRequestsRuntimeClient();
  return pullRequestsClientPromise;
}

export function getTuiAgentsRuntimeClient(): Promise<TuiAgentsRuntimeClient> {
  tuiAgentsClientPromise ??= createTuiAgentsRuntimeClient();
  return tuiAgentsClientPromise;
}

export function getTerminalsRuntimeClient(): Promise<TerminalsRuntimeClient> {
  terminalsClientPromise ??= createTerminalsRuntimeClient();
  return terminalsClientPromise;
}

export function getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient> {
  workspaceClientPromise ??= createWorkspaceRuntimeClient();
  return workspaceClientPromise;
}

export async function disposeDesktopWireWorkers(): Promise<void> {
  await automationsWorker?.stop();
  await host.dispose();
}

async function createAutomationsRuntimeClient(): Promise<AutomationsRuntimeClient> {
  const paths = automationRuntimePaths();
  mkdirSync(paths.stateDirectory, { recursive: true });
  const [workspace, acpSessions, tuiSessions] = await Promise.all([
    getWorkspaceRuntimeClient(),
    getAcpRuntimeClient(),
    getTuiAgentsRuntimeClient(),
  ]);
  automationsWorker ??= host.create(automationsComponent, {
    name: 'automations',
    executable: desktopWorkerPath('automations'),
    env: process.env,
    dependencies: {
      workspace,
      acpSessions,
      tuiSessions,
    },
    config: { dbFile: paths.dbFile },
    shutdownGraceMs: 3_000,
  });
  return await automationsWorker.ready();
}

async function createFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  const watcher = await fsWatchWorker.ready();
  filesWorker ??= host.create(filesComponent, {
    name: 'files',
    executable: desktopWorkerPath('files'),
    env: process.env,
    dependencies: {
      watcher,
    },
    config: {},
  });
  return await filesWorker.ready();
}

async function createFileSearchRuntimeClient(): Promise<FileSearchRuntimeClient> {
  const watcher = await fsWatchWorker.ready();
  fileSearchWorker ??= host.create(fileSearchComponent, {
    name: 'file-search',
    executable: desktopWorkerPath('file-search'),
    env: process.env,
    dependencies: {
      watcher,
    },
    config: {
      databasePath: resolveFileSearchDatabasePath(),
    },
  });
  return await fileSearchWorker.ready();
}

async function createGitRuntimeClient(): Promise<GitRuntimeClient> {
  const watcher = await fsWatchWorker.ready();
  gitWorker ??= host.create(gitComponent, {
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
  return await gitWorker.ready();
}

async function createMementosRuntimeClient(): Promise<MementosRuntimeClient> {
  mementosWorker ??= host.create(mementosComponent, {
    name: 'mementos',
    executable: desktopWorkerPath('mementos'),
    env: process.env,
    dependencies: {},
    config: {
      databasePath: join(app.getPath('userData'), 'mementos.db'),
      sweepPolicies: mementoSweepPolicies,
    },
  });
  return await mementosWorker.ready();
}

async function createPullRequestsRuntimeClient(): Promise<PullRequestsRuntimeClient> {
  pullRequestsWorker ??= host.create(pullRequestsComponent, {
    name: 'pull-requests',
    executable: desktopWorkerPath('pull-requests'),
    env: process.env,
    dependencies: {
      githubAuth: pullRequestsGitHubAuthController,
    },
    config: {
      databasePath: join(app.getPath('userData'), 'pull-requests.db'),
      incrementalIntervalMs: 5 * 60_000,
    },
  });
  return await pullRequestsWorker.ready();
}

async function createTuiAgentsRuntimeClient(): Promise<TuiAgentsRuntimeClient> {
  const localProjectSettings = await appSettingsService.get('localProject');
  tuiAgentsWorker ??= host.create(tuiAgentsComponent, {
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
  return withTuiConversationInputEvents(await tuiAgentsWorker.ready());
}

async function createTerminalsRuntimeClient(): Promise<TerminalsRuntimeClient> {
  terminalsWorker ??= host.create(terminalsComponent, {
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
  return await terminalsWorker.ready();
}

async function createWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient> {
  const { worktreePoolPath } = workspaceRuntimePaths();
  mkdirSync(worktreePoolPath, { recursive: true });
  const [terminals, watcher] = await Promise.all([
    getTerminalsRuntimeClient(),
    fsWatchWorker.ready(),
  ]);
  workspaceWorker ??= host.create(workspaceComponent, {
    name: 'workspace',
    executable: desktopWorkerPath('workspace'),
    env: process.env,
    dependencies: {
      terminals,
      watcher,
    },
    config: {
      provisioning: {
        worktreePoolPath,
        baseRemote: 'origin',
      },
    },
    // Consumer leases and active operation ownership are currently process-local.
    supervision: { restart: 'never' },
  });
  return await workspaceWorker.ready();
}

function withSessionIdPersistence(client: AcpRuntimeClient): AcpRuntimeClient {
  return {
    ...client,
    startSession: async (input, meta) => {
      const result = await client.startSession(input, meta);
      if (result.success) {
        await persistReturnedSessionId(input.input.conversationId, result.data.sessionId);
      }
      return result;
    },
    resumeSession: async (input, meta) => {
      const result = await client.resumeSession(input, meta);
      if (result.success) {
        await persistReturnedSessionId(input.input.conversationId, result.data.sessionId);
      }
      return result;
    },
  };
}

async function persistReturnedSessionId(conversationId: string, sessionId: string): Promise<void> {
  const result = await setSessionId(conversationId, sessionId);
  if (!result.success) {
    log.warn('ACP runtime failed to persist returned session id', {
      conversationId,
      error: result.error,
    });
  }
}

function withModePersistence(client: AcpRuntimeClient): AcpRuntimeClient {
  return {
    ...client,
    setModeOption: async (input, meta) => {
      const result = await client.setModeOption(input, meta);
      if (result.success) {
        await persistSelectedModeId(input.conversationId, input.value);
      }
      return result;
    },
  };
}

async function persistSelectedModeId(conversationId: string, modeId: string): Promise<void> {
  const result = await setConversationModeId(conversationId, modeId);
  if (!result.success) {
    log.warn('ACP runtime failed to persist selected mode id', {
      conversationId,
      error: result.error,
    });
    return;
  }
  conversationWireEvents.emit(undefined, {
    type: 'changed',
    conversationId,
    taskId: result.data.taskId,
    projectId: result.data.projectId,
    changes: { modeId },
  });
}

function withTuiConversationInputEvents(client: TuiAgentsRuntimeClient): TuiAgentsRuntimeClient {
  return {
    ...client,
    sendInput: async (input, meta) => {
      const result = await client.sendInput(input, meta);
      if (result.success && input.data.includes('\r')) {
        await recordTuiInputSubmitted(input.conversationId);
      }
      return result;
    },
  };
}

async function recordTuiInputSubmitted(conversationId: string): Promise<void> {
  const [row] = await db
    .select({
      projectId: conversations.projectId,
      taskId: conversations.taskId,
      providerId: conversations.provider,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!row) return;
  if (!row.providerId) return;

  telemetryService.capture('agent_run_started', {
    provider: row.providerId,
    project_id: row.projectId,
    task_id: row.taskId,
    conversation_id: conversationId,
  });

  const now = new Date().toISOString();
  await touchConversation(conversationId, now);
  conversationWireEvents.emit(undefined, {
    type: 'changed',
    conversationId,
    taskId: row.taskId,
    projectId: row.projectId,
    changes: { lastInteractedAt: now },
  });
}

import { join } from 'node:path';
import type { AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import { type AgentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import { type FileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { fileSearchComponent } from '@emdash/core/runtimes/file-search/node';
import type { FilesContract } from '@emdash/core/runtimes/files/api';
import { filesComponent } from '@emdash/core/runtimes/files/node';
import type { GitContract } from '@emdash/core/runtimes/git/api';
import { gitComponent } from '@emdash/core/runtimes/git/node';
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
import { app } from 'electron';
import { appScope } from '@main/app/app-scope';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { NON_INTERACTIVE_GIT_ENV } from '@main/core/execution-context/non-interactive-git-env';
import { resolveFileSearchDatabasePath } from '@main/core/file-search/database-path';
import { getGitExecutable } from '@main/core/utils/exec';
import { desktopKeyValueStore } from '@main/db/kv';
import { log } from '@main/lib/logger';
import { desktopWorkerPath } from '@main/worker-manifest';

export type AcpRuntimeClient = ContractClient<AcpApiContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;
export type FileSearchRuntimeClient = ContractClient<FileSearchContract>;
export type FilesRuntimeClient = ContractClient<FilesContract>;
export type GitRuntimeClient = ContractClient<GitContract>;
export type HostDependenciesClient = ContractClient<HostDependenciesContract>;

const workerScope = appScope.child('wire-workers');
const host = createWireWorkerHost({
  scope: workerScope,
  processSpawner: childProcessSpawner(),
  logger: log,
});

const acpComponent = createAcpComponent({ pluginRegistry, logger: log });
const agentConfigComponent = createAgentConfigComponent({ pluginRegistry, logger: log });
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

let fileSearchWorker: WireWorker<FileSearchContract> | undefined;
let fileSearchClientPromise: Promise<FileSearchRuntimeClient> | undefined;

let filesWorker: WireWorker<FilesContract> | undefined;
let filesClientPromise: Promise<FilesRuntimeClient> | undefined;

let gitWorker: WireWorker<GitContract> | undefined;
let gitClientPromise: Promise<GitRuntimeClient> | undefined;

export async function ensureFilesWorkerReady(): Promise<void> {
  await getFilesRuntimeClient();
}

export async function ensureFileSearchWorkerReady(): Promise<void> {
  await getFileSearchRuntimeClient();
}

export async function ensureGitWorkerReady(): Promise<void> {
  await getGitRuntimeClient();
}

export function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  acpClientPromise ??= acpWorker.ready().then(withSessionIdPersistence);
  return acpClientPromise;
}

export function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeClient> {
  agentConfigClientPromise ??= agentConfigWorker.ready();
  return agentConfigClientPromise;
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

export function disposeDesktopWireWorkers(): Promise<void> {
  return host.dispose();
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

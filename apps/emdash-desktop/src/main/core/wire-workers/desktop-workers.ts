import { join } from 'node:path';
import { acpApiContract, type AcpApiContract } from '@emdash/core/runtimes/acp/api';
import { createAcpComponent } from '@emdash/core/runtimes/acp/node';
import {
  agentConfigContract,
  type AgentConfigContract,
} from '@emdash/core/runtimes/agent-config/api';
import { createAgentConfigComponent } from '@emdash/core/runtimes/agent-config/node';
import { filesContract, type FilesContract } from '@emdash/core/runtimes/files/api';
import { filesComponent } from '@emdash/core/runtimes/files/node';
import { gitContract, type GitContract } from '@emdash/core/runtimes/git/api';
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
import {
  type Contract,
  type ContractDefinitions,
  type Controller,
  exposeWireToWindows,
  forwardController,
  validation,
  type ContractClient,
} from '@emdash/wire/api';
import { compose } from '@emdash/wire/util';
import { createWireWorkerHost, type WireWorker } from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { app, ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { NON_INTERACTIVE_GIT_ENV } from '@main/core/execution-context/non-interactive-git-env';
import { getGitExecutable } from '@main/core/utils/exec';
import { desktopKeyValueStore } from '@main/db/kv';
import { log } from '@main/lib/logger';
import { desktopWorkerPath } from '@main/worker-manifest';
import {
  ACP_WIRE_CHANNEL,
  AGENT_CONFIG_WIRE_CHANNEL,
  FILES_WIRE_CHANNEL,
  GIT_WIRE_CHANNEL,
} from '@shared/core/runtime/wire-channels';

export type AcpRuntimeClient = ContractClient<AcpApiContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;
export type FilesRuntimeClient = ContractClient<FilesContract>;
export type GitRuntimeClient = ContractClient<GitContract>;
export type HostDependenciesClient = ContractClient<HostDependenciesContract>;

const workerScope = appScope.child('wire-workers');
const host = createWireWorkerHost({
  scope: workerScope,
  processSpawner: childProcessSpawner(),
  logger: log,
});

function createMessageChannel() {
  const channel = new MessageChannelMain();
  return { port1: channel.port1, port2: channel.port2 };
}

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

let filesWorker: WireWorker<FilesContract> | undefined;
let filesClientPromise: Promise<FilesRuntimeClient> | undefined;

let gitWorker: WireWorker<GitContract> | undefined;
let gitClientPromise: Promise<GitRuntimeClient> | undefined;

if (typeof ipcMain?.handle === 'function') {
  installRendererWire();
}

export async function ensureFilesWorkerReady(): Promise<void> {
  await getFilesRuntimeClient();
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

function runtimeWireValidationPolicy() {
  return import.meta.env.DEV ? 'full' : 'inputs';
}

function installRendererWire(): void {
  exposeRuntimeToRenderer({
    channel: ACP_WIRE_CHANNEL,
    contract: acpApiContract,
    getClient: getAcpRuntimeClient,
  });
  exposeRuntimeToRenderer({
    channel: AGENT_CONFIG_WIRE_CHANNEL,
    contract: agentConfigContract,
    getClient: getAgentConfigRuntimeClient,
  });
  exposeRuntimeToRenderer({
    channel: FILES_WIRE_CHANNEL,
    contract: filesContract,
    getClient: getFilesRuntimeClient,
  });
  exposeRuntimeToRenderer({
    channel: GIT_WIRE_CHANNEL,
    contract: gitContract,
    getClient: getGitRuntimeClient,
  });
}

function exposeRuntimeToRenderer<Defs extends ContractDefinitions>({
  channel,
  contract,
  getClient,
}: {
  channel: string;
  contract: Contract<Defs>;
  getClient(): Promise<ContractClient<Defs>>;
}): void {
  const controller = lazyForwardController(contract, getClient);
  workerScope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      compose(controller, [validation(contract, runtimeWireValidationPolicy())]),
      { channel, beforeOpen: () => controller.ready() }
    )
  );
}

function lazyForwardController<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  getClient: () => Promise<ContractClient<Defs>>
): Controller & { ready(): Promise<void> } {
  let controller: Controller | undefined;
  async function ready(): Promise<void> {
    controller ??= forwardController(contract, await getClient());
  }
  return {
    ready,
    async call(path, input, meta) {
      await ready();
      return await controller!.call(path, input, meta);
    },
    resolveLive(topic) {
      if (!controller) throw new Error('Wire runtime is not ready');
      return controller.resolveLive(topic);
    },
    acquireLive(topic) {
      if (!controller) throw new Error('Wire runtime is not ready');
      return controller.acquireLive(topic);
    },
    async dispose() {
      await controller?.dispose?.();
    },
  } satisfies ReturnType<typeof forwardController<Defs>> & { ready(): Promise<void> };
}

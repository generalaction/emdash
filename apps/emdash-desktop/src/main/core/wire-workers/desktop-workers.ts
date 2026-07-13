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
import { fsWatchComponent } from '@emdash/core/services/fs-watch/node';
import {
  exposeWireToWindows,
  forwardController,
  validation,
  type ContractClient,
} from '@emdash/wire/api';
import { compose } from '@emdash/wire/util';
import { createWireWorkerHost } from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { app, ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { NON_INTERACTIVE_GIT_ENV } from '@main/core/execution-context/non-interactive-git-env';
import { getGitExecutable } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { desktopWorkerPath } from '@main/worker-manifest';
import { FILES_WIRE_CHANNEL, GIT_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';

const ACP_WIRE_CHANNEL = 'acp-wire';
const AGENT_CONFIG_WIRE_CHANNEL = 'agent-config-wire';

export type AcpRuntimeClient = ContractClient<AcpApiContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;
export type FilesRuntimeClient = ContractClient<FilesContract>;
export type GitRuntimeClient = ContractClient<GitContract>;

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

const fsWatchWorker = host.create(fsWatchComponent, {
  name: 'fs-watch',
  executable: desktopWorkerPath('fs-watch'),
  env: process.env,
  dependencies: {},
  config: {},
});

export const acpWorker = host.create(acpComponent, {
  name: 'acp',
  executable: desktopWorkerPath('acp'),
  env: process.env,
  dependencies: {},
  config: {
    attachmentsDir: join(app?.getPath?.('userData') ?? process.cwd(), 'acp-attachments'),
  },
});

export const acpClient: AcpRuntimeClient = withSessionIdPersistence(acpWorker.client);

export const agentConfigWorker = host.create(agentConfigComponent, {
  name: 'agent-config',
  executable: desktopWorkerPath('agent-config'),
  env: process.env,
  dependencies: {},
  config: {},
});

export const agentConfigClient: AgentConfigRuntimeClient = agentConfigWorker.client;

export const filesWorker = host.create(filesComponent, {
  name: 'files',
  executable: desktopWorkerPath('files'),
  env: process.env,
  dependencies: {
    watcher: fsWatchWorker.client,
  },
  config: {},
});

export const filesClient: FilesRuntimeClient = filesWorker.client;

export const gitWorker = host.create(gitComponent, {
  name: 'git',
  executable: desktopWorkerPath('git'),
  env: {
    ...process.env,
    ...NON_INTERACTIVE_GIT_ENV,
    LC_ALL: 'C',
    LANG: 'C',
    LANGUAGE: 'C',
  },
  dependencies: {
    watcher: fsWatchWorker.client,
  },
  config: {
    executable: getGitExecutable(),
    env: {
      ...process.env,
      ...NON_INTERACTIVE_GIT_ENV,
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
    },
  },
});

export const gitClient: GitRuntimeClient = gitWorker.client;

if (typeof ipcMain?.handle === 'function') {
  installRendererWire();
}

export async function ensureFilesWorkerReady(): Promise<void> {
  await fsWatchWorker.ready();
  await filesWorker.ready();
}

export async function ensureGitWorkerReady(): Promise<void> {
  await fsWatchWorker.ready();
  await gitWorker.ready();
}

export function disposeDesktopWireWorkers(): Promise<void> {
  return host.dispose();
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
  workerScope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      compose(forwardController(acpApiContract, acpClient), [
        validation(acpApiContract, runtimeWireValidationPolicy()),
      ]),
      {
        channel: ACP_WIRE_CHANNEL,
        beforeOpen: async () => {
          await acpWorker.ready();
        },
      }
    )
  );

  workerScope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      compose(forwardController(agentConfigContract, agentConfigClient), [
        validation(agentConfigContract, runtimeWireValidationPolicy()),
      ]),
      {
        channel: AGENT_CONFIG_WIRE_CHANNEL,
        beforeOpen: async () => {
          await agentConfigWorker.ready();
        },
      }
    )
  );

  workerScope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      compose(forwardController(filesContract, filesClient), [
        validation(filesContract, runtimeWireValidationPolicy()),
      ]),
      {
        channel: FILES_WIRE_CHANNEL,
        beforeOpen: async () => {
          await ensureFilesWorkerReady();
        },
      }
    )
  );

  workerScope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      compose(forwardController(gitContract, gitClient), [
        validation(gitContract, runtimeWireValidationPolicy()),
      ]),
      {
        channel: GIT_WIRE_CHANNEL,
        beforeOpen: async () => {
          await ensureGitWorkerReady();
        },
      }
    )
  );
}

import { join } from 'node:path';
import { acpApiContract, type AcpApiContract } from '@emdash/core/acp';
import { agentConfigContract, type AgentConfigContract } from '@emdash/core/workspace-server';
import {
  exposeWireToWindows,
  forwardController,
  validation,
  type ContractClient,
} from '@emdash/wire/api';
import { compose } from '@emdash/wire/util';
import { createWireWorkerHost } from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import { app, ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { log } from '@main/lib/logger';
import { desktopWorkerPath } from '@main/worker-manifest';

const ACP_WIRE_CHANNEL = 'acp-wire';
const AGENT_CONFIG_WIRE_CHANNEL = 'agent-config-wire';

export type AcpRuntimeClient = ContractClient<AcpApiContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;

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

export const acpWorker = host.define({
  name: 'acp',
  contract: acpApiContract,
  process: () => ({
    entry: desktopWorkerPath('acp'),
    env: {
      ...process.env,
      EMDASH_ACP_ATTACHMENTS_DIR: join(app.getPath('userData'), 'acp-attachments'),
    },
  }),
});

export const acpClient: AcpRuntimeClient = withSessionIdPersistence(acpWorker.client);

export const agentConfigWorker = host.define({
  name: 'agent-config',
  contract: agentConfigContract,
  process: () => ({
    entry: desktopWorkerPath('agent-config'),
    env: process.env,
  }),
});

export const agentConfigClient: AgentConfigRuntimeClient = agentConfigWorker.client;

installRendererWire();

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
}

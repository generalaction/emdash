import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { acpApiContract, type AcpApiContract } from '@emdash/core/acp';
import {
  exposeWireToWindows,
  forwardController,
  withValidation,
  type ContractClient,
} from '@emdash/wire/api';
import { type ManagedProcess } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import { forwardRuntimeLogs, spawnRuntime } from '@emdash/wire/util/process-runtime';
import { app, ipcMain, MessageChannelMain } from 'electron';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { log } from '@main/lib/logger';

const ACP_WIRE_CHANNEL = 'acp-wire';

type AcpRuntimeHandle = Awaited<ReturnType<typeof spawnAcpRuntime>>;
export type AcpRuntimeClient = ContractClient<AcpApiContract>;

let handlePromise: Promise<AcpRuntimeHandle> | null = null;
let rendererWireDispose: (() => void) | null = null;

export function initializeAcpRuntimeProcess(): Promise<AcpRuntimeHandle> {
  if (handlePromise) return handlePromise;
  handlePromise = spawnAcpRuntime().then((handle) => {
    installRendererWire(handle.client);
    app.once('before-quit', () => {
      void disposeAcpRuntimeProcess();
    });
    return handle;
  });
  return handlePromise;
}

export async function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  return (await initializeAcpRuntimeProcess()).client;
}

export async function disposeAcpRuntimeProcess(): Promise<void> {
  rendererWireDispose?.();
  rendererWireDispose = null;
  const handle = await handlePromise;
  handlePromise = null;
  await handle?.dispose();
}

async function spawnAcpRuntime() {
  const entry = resolveRuntimeEntry();
  log.info('ACP runtime child process entry resolved', { entry });
  const handle = await spawnRuntime({
    host: childProcessHost(),
    contract: acpApiContract,
    spec: {
      entry,
      env: {
        ...process.env,
        EMDASH_ACP_ATTACHMENTS_DIR: join(app.getPath('userData'), 'acp-attachments'),
      },
      supervision: { restart: 'on-failure', backoffMs: [250, 1_000, 2_500], maxRestarts: 5 },
    },
    onProcess: attachAcpRuntimeLogging,
  });
  handle.onRestarted(() => {
    log.info('ACP runtime child process restarted');
  });
  return { ...handle, client: withSessionIdPersistence(handle.client) };
}

function attachAcpRuntimeLogging(process: ManagedProcess): void {
  forwardRuntimeLogs(process, log, { source: 'acp-runtime' });
  process.onExit((exit) => {
    log.warn('ACP runtime child process exited', exit);
  });
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

function installRendererWire(client: AcpRuntimeClient): void {
  rendererWireDispose?.();
  const controller = withValidation(
    acpApiContract,
    forwardController(acpApiContract, client),
    runtimeWireValidationPolicy()
  );
  rendererWireDispose = exposeWireToWindows(
    {
      ipcMain,
      createMessageChannel: () => {
        const channel = new MessageChannelMain();
        return { port1: channel.port1, port2: channel.port2 };
      },
    },
    controller,
    { channel: ACP_WIRE_CHANNEL }
  );
}

function runtimeWireValidationPolicy() {
  return import.meta.env.DEV ? 'full' : 'inputs';
}

function resolveRuntimeEntry(): string {
  const candidates = [join(__dirname, 'acp-runtime.js'), join(__dirname, 'acp-runtime.mjs')];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error(
      `ACP runtime child process entry is missing. Checked: ${candidates.join(', ')}`
    );
  }
  return entry;
}

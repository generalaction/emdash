import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { acpApiContract, acpHostContract } from '@emdash/core/acp';
import { ok } from '@emdash/shared';
import { createController, exposeWireToWindows, serve, withValidation } from '@emdash/wire/api';
import { processTransport, type ManagedProcess } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import { spawnRuntime } from '@emdash/wire/util/process-runtime';
import { app, ipcMain, MessageChannelMain } from 'electron';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { log } from '@main/lib/logger';
import { resolveLocalAcpSpawnContext } from '../transport/local-acp-process-host';

const ACP_WIRE_CHANNEL = 'acp-wire';

type AcpRuntimeHandle = Awaited<ReturnType<typeof spawnAcpRuntime>>;
export type AcpRuntimeClient = AcpRuntimeHandle['client'];

let handlePromise: Promise<AcpRuntimeHandle> | null = null;
let rendererWireDispose: (() => void) | null = null;
let hostWireDispose: (() => void) | null = null;

export function initializeAcpRuntimeProcess(): Promise<AcpRuntimeHandle> {
  if (handlePromise) return handlePromise;
  handlePromise = spawnAcpRuntime().then((handle) => {
    installHostWire(handle);
    installRendererWire(handle.client);
    app.once('before-quit', () => {
      void disposeAcpRuntimeProcess();
    });
    return handle;
  });
  return handlePromise;
}

export async function getAcpRuntimeHandle(): Promise<AcpRuntimeHandle> {
  return initializeAcpRuntimeProcess();
}

export async function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  return (await getAcpRuntimeHandle()).client;
}

export async function disposeAcpRuntimeProcess(): Promise<void> {
  rendererWireDispose?.();
  rendererWireDispose = null;
  hostWireDispose?.();
  hostWireDispose = null;
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
  return handle;
}

function attachAcpRuntimeLogging(process: ManagedProcess): void {
  process.onStdio((stream, chunk) => {
    if (stream === 'stderr') {
      log.warn('ACP runtime stderr', { chunk });
    } else {
      log.debug('ACP runtime stdout', { chunk });
    }
  });
  process.onExit((exit) => {
    log.warn('ACP runtime child process exited', exit);
  });
}

function installHostWire(handle: AcpRuntimeHandle): void {
  hostWireDispose?.();
  const transport = processTransport(handle.process);
  const controller = withValidation(
    acpHostContract,
    createController(acpHostContract, {
      resolveSpawnContext: ({ providerId }) => resolveLocalAcpSpawnContext(providerId),
      persistSessionId: async ({ conversationId, sessionId }) => {
        const result = await setSessionId(conversationId, sessionId);
        if (!result.success) {
          log.warn('ACP runtime failed to persist session id', {
            conversationId,
            error: result.error,
          });
        }
      },
      log: ({ level, message, data }) => {
        log[level](message, { source: 'acp-runtime', data });
      },
    }),
    runtimeWireValidationPolicy()
  );
  const disposeServer = serve(transport, controller);
  hostWireDispose = () => {
    disposeServer();
    transport.close?.();
  };
}

function installRendererWire(client: AcpRuntimeClient): void {
  rendererWireDispose?.();
  const controller = withValidation(
    acpApiContract,
    createController(acpApiContract, {
      startSession: (input, meta) => client.startSession(input, meta),
      resumeSession: (input, meta) => client.resumeSession(input, meta),
      stopSession: (input, meta) => client.stopSession(input, meta),
      sendPrompt: (input, meta) => client.sendPrompt(input, meta),
      queuePrompt: (input, meta) => client.queuePrompt(input, meta),
      editQueuedPrompt: (input, meta) => client.editQueuedPrompt(input, meta),
      deleteQueuedPrompt: (input, meta) => client.deleteQueuedPrompt(input, meta),
      changeQueuePromptOrder: (input, meta) => client.changeQueuePromptOrder(input, meta),
      cancelTurn: (input, meta) => client.cancelTurn(input, meta),
      setModelOption: (input, meta) => client.setModelOption(input, meta),
      setModeOption: (input, meta) => client.setModeOption(input, meta),
      resolvePermission: (input, meta) => client.resolvePermission(input, meta),
      setPromptDraft: (input, meta) => client.setPromptDraft(input, meta),
      exportACPTranscript: (input, meta) => client.exportACPTranscript(input, meta),
      exportRawAcpLog: (input, meta) => client.exportRawAcpLog(input, meta),
      uploadAttachment: (input, file, meta) => client.uploadAttachment(input, file, meta),
      downloadAttachment: async (input, meta) => {
        const result = await client.downloadAttachment(input, meta);
        if (!result.success) return result;
        return ok({ meta: result.data.meta, source: result.data.chunks() });
      },
      deleteAttachment: (input, meta) => client.deleteAttachment(input, meta),
      getHistory: (input, meta) => client.getHistory(input, meta),
      startLogin: (input, meta) => client.startLogin(input, meta),
      cancelLogin: (input, meta) => client.cancelLogin(input, meta),
      sendLoginInput: (input, meta) => client.sendLoginInput(input, meta),
      resizeLogin: (input, meta) => client.resizeLogin(input, meta),
      markUrlHandled: (input, meta) => client.markUrlHandled(input, meta),
      refreshAuthStatus: (input, meta) => client.refreshAuthStatus(input, meta),
      sessions: client.sessions,
      session: client.session,
      terminalOutput: client.terminalOutput,
      authStatus: client.authStatus,
      loginOutput: client.loginOutput,
    }),
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

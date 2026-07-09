import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  acpApiContract,
  acpHostContract,
} from '@emdash/core/acp';
import { ok } from '@emdash/shared';
import { createController, exposeWireToWindows, serve } from '@emdash/wire/api';
import { processTransport, utilityProcessHost, type UtilityForkLike } from '@emdash/wire/process';
import { spawnRuntime } from '@emdash/wire/util/process-runtime';
import { app, ipcMain, MessageChannelMain, utilityProcess } from 'electron';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { log } from '@main/lib/logger';
import { agentAuthService } from '../../agents/agent-auth-service';
import { resolveLocalAcpSpawnContext } from '../transport/local-acp-process-host';

const ACP_WIRE_CHANNEL = 'acp-wire';

type AcpRuntimeHandle = Awaited<ReturnType<typeof spawnAcpRuntime>>;
export type AcpRuntimeClient = AcpRuntimeHandle['client'];
type EventEmitterLike = {
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
};

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
  log.info('ACP runtime utility process entry resolved', { entry });
  const handle = await spawnRuntime({
    host: utilityProcessHost({ fork: forkUtilityProcess }),
    contract: acpApiContract,
    spec: {
      entry,
      env: {
        ...process.env,
        EMDASH_ACP_ATTACHMENTS_DIR: join(app.getPath('userData'), 'acp-attachments'),
      },
      supervision: { restart: 'on-failure', backoffMs: [250, 1_000, 2_500], maxRestarts: 5 },
    },
  });
  handle.process.onStdio((stream, chunk) => {
    if (stream === 'stderr') {
      log.warn('ACP runtime stderr', { chunk });
    } else {
      log.debug('ACP runtime stdout', { chunk });
    }
  });
  handle.process.onExit((exit) => {
    log.warn('ACP runtime utility process exited', exit);
  });
  handle.onRestarted(() => {
    log.info('ACP runtime utility process restarted');
  });
  return handle;
}

const forkUtilityProcess: UtilityForkLike = (entry, args, options) => {
  const child = utilityProcess.fork(entry, args, { ...options, stdio: 'pipe' });
  const events = child as unknown as EventEmitterLike;
  return {
    get pid() {
      return child.pid;
    },
    postMessage: (message) => child.postMessage(message),
    kill: () => child.kill(),
    on: (event, cb) => events.on(event, cb),
    off: (event, cb) => events.off(event, cb),
    stdout: child.stdout ?? undefined,
    stderr: child.stderr ?? undefined,
  };
};

function installHostWire(handle: AcpRuntimeHandle): void {
  hostWireDispose?.();
  const transport = processTransport(handle.process);
  const controller = createController(
    acpHostContract,
    {
      resolveSpawnContext: ({ providerId }) => resolveLocalAcpSpawnContext(providerId),
      checkAuth: ({ providerId }) => agentAuthService.getStatus(providerId),
      markAuthRequired: ({ providerId, message }) => {
        agentAuthService.markUnauthenticated(providerId, message);
      },
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
    },
    { validate: 'full' }
  );
  const disposeServer = serve(transport, controller);
  hostWireDispose = () => {
    disposeServer();
    transport.close?.();
  };
}

function installRendererWire(client: AcpRuntimeClient): void {
  rendererWireDispose?.();
  const controller = createController(
    acpApiContract,
    {
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
      sessions: client.sessions,
      session: client.session,
      terminalOutput: client.terminalOutput,
    },
    { validate: 'full' }
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

function resolveRuntimeEntry(): string {
  const candidates = [join(__dirname, 'acp-runtime.js'), join(__dirname, 'acp-runtime.mjs')];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error(
      `ACP runtime utility process entry is missing. Checked: ${candidates.join(', ')}`
    );
  }
  return entry;
}

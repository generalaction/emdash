import { readFile } from 'node:fs/promises';
import {
  AcpRuntime,
  acpHostContract,
  createAcpController,
  type AcpRuntimeDeps,
} from '@emdash/core/acp';
import type { AgentAuthStatus } from '@emdash/core/agents/plugins';
import { client, connect, isWireMessage, type WireTransport } from '@emdash/wire';
import {
  serveProcessRuntime,
  type ProcessRuntimePort,
} from '@emdash/wire/util/process-runtime';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { Logger, LogFields, LogLevel } from '@emdash/shared/logger';
import { ChildAcpProcessHost } from './child-process-host';
import { LocalAttachmentStore } from './local-attachment-store';

type UtilityParentPort = {
  postMessage(message: unknown): void;
  on(event: 'message', cb: (event: { data: unknown }) => void): void;
  off(event: 'message', cb: (event: { data: unknown }) => void): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;

if (!parentPort) {
  throw new Error('ACP runtime process started without parentPort');
}

const AUTH_STATUS_TIMEOUT_MS = 10_000;
const attachmentsDir = process.env.EMDASH_ACP_ATTACHMENTS_DIR;

if (!attachmentsDir) {
  throw new Error('ACP runtime process started without EMDASH_ACP_ATTACHMENTS_DIR');
}

const runtimePort = createRuntimePort(parentPort);
const hostTransport = createHostTransport(runtimePort);
const hostClient = client(acpHostContract, connect(hostTransport));
const childHost = new ChildAcpProcessHost(hostClient);
const logger = createParentLogger(hostClient);
const attachmentStore = new LocalAttachmentStore(attachmentsDir);

void serveProcessRuntime(
  (scope) => {
    const runtime = new AcpRuntime({
      resolveAcp: (providerId) => {
        const plugin = pluginRegistry.get(providerId);
        if (!plugin || plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior.acp) {
          return null;
        }
        return { behavior: plugin.behavior.acp };
      },
      host: childHost,
      persistSessionId: async (conversationId, sessionId) => {
        await hostClient.persistSessionId({ conversationId, sessionId });
        return { success: true, data: undefined };
      },
      checkAuth: (providerId) => checkAuthWithTimeout(providerId),
      onAuthRequired: (providerId) => {
        void hostClient.markAuthRequired({ providerId });
      },
      resolveAttachment: async (attachment) => {
        if (attachment.type === 'attachment') {
          const stored = await attachmentStore.get(attachment.id);
          if (!stored) {
            throw new Error(`Attachment '${attachment.id}' could not be resolved`);
          }
          return {
            data: Buffer.from(stored.data).toString('base64'),
            mimeType: stored.ref.mimeType,
          };
        }
        const data = await readFile(attachment.originalPath);
        return {
          data: data.toString('base64'),
          mimeType: attachment.mimeType,
        };
      },
      attachmentStore,
      logger,
    } satisfies AcpRuntimeDeps);
    scope.add(() => runtime.killAllTerminals());
    return createAcpController(runtime);
  },
  { port: runtimePort, logger }
).catch((error: unknown) => {
  process.stderr.write(
    `ACP runtime process failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});

function checkAuthWithTimeout(providerId: string): Promise<AgentAuthStatus> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      logger.warn('ACP runtime auth status check timed out', {
        providerId,
        timeoutMs: AUTH_STATUS_TIMEOUT_MS,
      });
      resolve({ kind: 'unknown' });
    }, AUTH_STATUS_TIMEOUT_MS);
    hostClient.checkAuth({ providerId }).then(
      (status) => {
        clearTimeout(timeout);
        resolve(status);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function createParentLogger(
  host: typeof hostClient,
  bindings: LogFields = {}
): Logger {
  const emit = (level: LogLevel, message: string, data?: LogFields): void => {
    void host.log({
      level,
      message,
      data: data ? { ...bindings, ...data } : bindings,
    });
  };
  return {
    level: 'debug',
    debug: (message, data) => emit('debug', message, data),
    info: (message, data) => emit('info', message, data),
    warn: (message, data) => emit('warn', message, data),
    error: (message, data) => emit('error', message, data),
    child: (next) => createParentLogger(host, { ...bindings, ...next }),
  };
}

function createRuntimePort(port: UtilityParentPort): ProcessRuntimePort {
  return {
    send(message) {
      port.postMessage(message);
    },
    onMessage(cb) {
      const listener = (event: { data: unknown }): void => cb(event.data);
      port.on('message', listener);
      return () => port.off('message', listener);
    },
    onDisconnect() {
      return () => {};
    },
  };
}

function createHostTransport(port: ProcessRuntimePort): WireTransport {
  return {
    post(message) {
      port.send(message);
    },
    onMessage(cb) {
      return port.onMessage((message) => {
        if (isWireMessage(message)) cb(message);
      });
    },
    onDisconnect(cb) {
      return port.onDisconnect(cb);
    },
  };
}

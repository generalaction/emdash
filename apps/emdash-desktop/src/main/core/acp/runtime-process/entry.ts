import { readFile } from 'node:fs/promises';
import {
  AcpRuntime,
  createAcpLiveResolver,
  createAcpProcedures,
  type AcpRuntimeDeps,
} from '@emdash/core/acp';
import type { AgentAuthStatus } from '@emdash/core/agents/plugins';
import { localWire, serveWire } from '@emdash/core/wire';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { Logger, LogFields, LogLevel } from '@emdash/shared/logger';
import { ChildAcpProcessHost } from './child-process-host';
import { LocalAttachmentStore } from './local-attachment-store';
import type { UtilityParentPort } from './protocol';

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;

if (!parentPort) {
  throw new Error('ACP runtime process started without parentPort');
}

const childHost = new ChildAcpProcessHost(parentPort);
const logger = createParentLogger(parentPort);
const pendingAuthChecks = new Map<
  string,
  { resolve: (value: AgentAuthStatus) => void; reject: (error: Error) => void }
>();
const attachmentsDir = process.env.EMDASH_ACP_ATTACHMENTS_DIR;

if (!attachmentsDir) {
  throw new Error('ACP runtime process started without EMDASH_ACP_ATTACHMENTS_DIR');
}

const attachmentStore = new LocalAttachmentStore(attachmentsDir);

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
    parentPort.postMessage({ type: 'persist-session-id', conversationId, sessionId });
    return { success: true, data: undefined };
  },
  checkAuth: (providerId) => requestAuthStatus(providerId),
  onAuthRequired: (providerId) => {
    parentPort.postMessage({ type: 'mark-auth-required', providerId });
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

serveWire(parentPort, localWire(createAcpProcedures(runtime), createAcpLiveResolver(runtime)));

parentPort.on('message', (event) => {
  const message = event.data;
  childHost.handleMessage(message);
  handleAuthStatusMessage(message);

  if (!isHostMessage(message)) return;
  switch (message.type) {
    case 'shutdown':
      runtime.killAllTerminals();
      process.exit(0);
      break;
  }
});

function requestAuthStatus(providerId: string): Promise<AgentAuthStatus> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingAuthChecks.set(requestId, { resolve, reject });
    parentPort.postMessage({ type: 'check-auth', requestId, providerId });
  });
}

function handleAuthStatusMessage(message: unknown): void {
  if (!isAuthStatusResult(message)) return;
  const pending = pendingAuthChecks.get(message.requestId);
  if (!pending) return;
  pendingAuthChecks.delete(message.requestId);
  if (message.ok) {
    pending.resolve(message.value);
  } else {
    pending.reject(new Error(message.error));
  }
}

function createParentLogger(port: UtilityParentPort, bindings: LogFields = {}): Logger {
  const emit = (level: LogLevel, message: string, data?: LogFields): void => {
    port.postMessage({
      type: 'log',
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
    child: (next) => createParentLogger(port, { ...bindings, ...next }),
  };
}

function isHostMessage(value: unknown): value is { type: 'shutdown' } {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'shutdown'
  );
}

function isAuthStatusResult(value: unknown): value is
  | {
      type: 'check-auth-result';
      requestId: string;
      ok: true;
      value: AgentAuthStatus;
    }
  | {
      type: 'check-auth-result';
      requestId: string;
      ok: false;
      error: string;
    } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'check-auth-result' &&
    typeof (value as { requestId?: unknown }).requestId === 'string'
  );
}

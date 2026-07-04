import { readFile } from 'node:fs/promises';
import { AcpRuntime, createAcpRouter, serveAcpPort, type AcpRuntimeDeps } from '@emdash/core/acp';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { Logger, LogFields, LogLevel } from '@emdash/shared/logger';
import { ChildAcpProcessHost } from './child-process-host';
import type { RuntimeMessagePort, UtilityParentPort } from './protocol';

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;

if (!parentPort) {
  throw new Error('ACP runtime process started without parentPort');
}

const childHost = new ChildAcpProcessHost(parentPort);
const logger = createParentLogger(parentPort);

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
  resolveAttachment: async (attachment) => {
    const data = await readFile(attachment.originalPath);
    return {
      data: data.toString('base64'),
      mimeType: attachment.mimeType,
    };
  },
  logger,
} satisfies AcpRuntimeDeps);

const router = createAcpRouter(runtime);

parentPort.on('message', (eventOrMessage: unknown, handle: unknown) => {
  const { message, port } = normalizeParentMessage(eventOrMessage, handle);
  childHost.handleMessage(message);

  if (!isHostMessage(message)) return;
  switch (message.type) {
    case 'client-port': {
      if (!port) {
        logger.warn('ACP runtime child received client-port without a transferable port');
        return;
      }
      serveAcpPort(router, port);
      break;
    }
    case 'shutdown':
      runtime.killAllTerminals();
      process.exit(0);
      break;
  }
});

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

function isHostMessage(value: unknown): value is { type: 'client-port' | 'shutdown' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    ((value as { type?: unknown }).type === 'client-port' ||
      (value as { type?: unknown }).type === 'shutdown')
  );
}

function normalizeParentMessage(
  eventOrMessage: unknown,
  handle: unknown
): { message: unknown; port: RuntimeMessagePort | null } {
  if (isMessageEventLike(eventOrMessage)) {
    return {
      message: eventOrMessage.data,
      port: extractPort(eventOrMessage.data, handle, eventOrMessage.ports),
    };
  }
  return {
    message: eventOrMessage,
    port: extractPort(eventOrMessage, handle),
  };
}

function isMessageEventLike(value: unknown): value is { data: unknown; ports?: unknown[] } {
  return typeof value === 'object' && value !== null && 'data' in value;
}

function extractPort(
  message: unknown,
  handle: unknown,
  eventPorts: readonly unknown[] = []
): RuntimeMessagePort | null {
  if (handle) return handle as RuntimeMessagePort;
  const [eventPort] = eventPorts;
  if (eventPort) return eventPort as RuntimeMessagePort;
  if (typeof message === 'object' && message !== null) {
    const maybePort = (message as { port?: unknown; ports?: unknown[] }).port;
    if (maybePort) return maybePort as RuntimeMessagePort;
    const [first] = (message as { ports?: unknown[] }).ports ?? [];
    if (first) return first as RuntimeMessagePort;
  }
  return null;
}

import { readFile } from 'node:fs/promises';
import { acpRouter, createAcpRuntime, type AcpRuntimeDeps } from '@emdash/core/acp';
import { pluginRegistry } from '@emdash/plugins/agents';
import type { Logger, LogFields, LogLevel } from '@emdash/shared/logger';
import { ChildAcpProcessHost } from './child-process-host';
import type { UtilityParentPort } from './protocol';

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;

if (!parentPort) {
  throw new Error('ACP runtime process started without parentPort');
}

const childHost = new ChildAcpProcessHost(parentPort);
const logger = createParentLogger(parentPort);

const acp = createAcpRuntime(acpRouter, {
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

parentPort.on('message', (event) => {
  const message = event.data;
  childHost.handleMessage(message);

  if (!isHostMessage(message)) return;
  switch (message.type) {
    case 'client-port': {
      const [port] = event.ports;
      if (!port) {
        logger.warn('ACP runtime child received client-port without a transferable port');
        return;
      }
      acp.servePort(port);
      port.start();
      break;
    }
    case 'shutdown':
      acp.runtime.killAllTerminals();
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

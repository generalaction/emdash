import { readFile } from 'node:fs/promises';
import { acpApiContract, acpHostContract } from '@emdash/core/acp';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { ok } from '@emdash/shared';
import type { Logger, LogFields, LogLevel } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import {
  client,
  connect,
  isWireMessage,
  withValidation,
  type ContractClient,
  type ValidatePolicy,
  type WireTransport,
} from '@emdash/wire';
import { serveProcessRuntime, type ProcessRuntimePort } from '@emdash/wire/util/process-runtime';
import { createAcpController } from '../api/controller';
import { AcpRuntime } from '../runtime/runtime';
import type { AcpRuntimeDeps } from '../runtime/types';
import { ChildAcpProcessHost } from './child-process-host';
import { LocalAttachmentStore } from './local-attachment-store';

export type BootAcpRuntimeProcessOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  port?: ProcessRuntimePort;
  exit?: (code: number) => void;
};

export function bootAcpRuntimeProcess(options: BootAcpRuntimeProcessOptions): void {
  const env = options.env ?? process.env;
  const attachmentsDir = env.EMDASH_ACP_ATTACHMENTS_DIR;

  if (!attachmentsDir) {
    throw new Error('ACP runtime process started without EMDASH_ACP_ATTACHMENTS_DIR');
  }

  const runtimePort = options.port ?? createNodeRuntimePort();
  const hostTransport = createHostTransport(runtimePort);
  const hostClient = client(acpHostContract, connect(hostTransport));
  const childHost = new ChildAcpProcessHost(hostClient);
  const logger = createParentLogger(hostClient);
  const attachmentStore = new LocalAttachmentStore(attachmentsDir);

  void serveProcessRuntime(
    (scope) => {
      const acp = new AcpRuntime({
        pluginHost: new AgentPluginHost(options.pluginRegistry),
        host: childHost,
        persistSessionId: async (conversationId, sessionId) => {
          await hostClient.persistSessionId({ conversationId, sessionId });
          return ok(undefined);
        },
        resolveAttachment: async (attachment) => {
          if (attachment.type === 'attachment') {
            const stored = await attachmentStore.get(attachment.id);
            if (!stored) throw new Error(`Attachment '${attachment.id}' could not be resolved`);
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

      scope.add(() => acp.dispose());
      return withValidation(acpApiContract, createAcpController(acp), runtimeWireValidationPolicy(env));
    },
    { port: runtimePort, exit: options.exit, logger }
  ).catch((error: unknown) => {
    process.stderr.write(
      `ACP runtime process failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    (options.exit ?? process.exit)(1);
  });
}

function runtimeWireValidationPolicy(env: NodeJS.ProcessEnv): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

function createParentLogger(
  host: ContractClient<typeof acpHostContract>,
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

function createNodeRuntimePort(): ProcessRuntimePort {
  if (typeof process.send !== 'function') {
    throw new Error('ACP runtime process requires an IPC channel to the parent process');
  }

  return {
    send(message) {
      process.send?.(message as Parameters<NonNullable<NodeJS.Process['send']>>[0]);
    },
    onMessage(cb) {
      process.on('message', cb);
      return () => process.off('message', cb);
    },
    onDisconnect(cb) {
      process.on('disconnect', cb);
      return () => process.off('disconnect', cb);
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


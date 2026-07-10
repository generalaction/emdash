import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { acpApiContract, acpHostContract } from '@emdash/core/acp';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import {
  createSpawnContextResolver,
  type SpawnContextResolver,
} from '@emdash/core/agents/spawn-context';
import { buildDescriptorFromProvider, HostDependencyManager } from '@emdash/core/deps/runtime';
import { NodeExecutionContext } from '@emdash/core/exec';
import { ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { initProcessLogging } from '@emdash/shared/logger/node';
import type { PluginRegistry } from '@emdash/shared/plugins';
import {
  client,
  connect,
  isWireMessage,
  withValidation,
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
  const childHost = new ChildAcpProcessHost();
  const logger = initProcessLogging({ name: 'acp-agents-runtime', env });
  const spawnContext = createAcpSpawnContextResolver({
    pluginRegistry: options.pluginRegistry,
    env,
    logger,
  });
  const attachmentStore = new LocalAttachmentStore(attachmentsDir);

  void serveProcessRuntime(
    (scope) => {
      const acp = new AcpRuntime({
        pluginHost: new AgentPluginHost(options.pluginRegistry),
        host: childHost,
        spawnContext,
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
      return withValidation(
        acpApiContract,
        createAcpController(acp),
        runtimeWireValidationPolicy(env)
      );
    },
    { port: runtimePort, exit: options.exit, logger }
  ).catch((error: unknown) => {
    logger.error('ACP runtime process failed', { error: errorMessage(error) });
    (options.exit ?? process.exit)(1);
  });
}

function runtimeWireValidationPolicy(env: NodeJS.ProcessEnv): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

function createAcpSpawnContextResolver(options: {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env: NodeJS.ProcessEnv;
  logger: Logger;
}): SpawnContextResolver {
  const homeDir = os.homedir();
  const descriptors = options.pluginRegistry.getAll().map(buildDescriptorFromProvider);
  const manager = new HostDependencyManager(new NodeExecutionContext({ env: options.env }), {
    dependencies: descriptors,
    getDependencyDescriptor: (id) => descriptors.find((descriptor) => descriptor.id === id),
    logger: options.logger,
  });

  return createSpawnContextResolver({
    resolveCli: async (providerId: string) => {
      if (!options.pluginRegistry.get(providerId)) {
        throw new Error(`Provider '${providerId}' was not found`);
      }
      let state = manager.get(providerId);
      if (!state?.path) state = await manager.probe(providerId);
      if (state.path) return state.path;

      const descriptor = descriptors.find((candidate) => candidate.id === providerId);
      return descriptor?.commands[0] ?? providerId;
    },
    hasProvider: (providerId: string) => options.pluginRegistry.get(providerId) !== undefined,
    env: options.env,
    homeDir,
    includeShellVar: true,
  });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

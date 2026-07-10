import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { acpApiContract } from '@emdash/core/acp';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import { createLocalPluginFs } from '@emdash/core/agents/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/exec';
import { initProcessLogging } from '@emdash/shared/logger/node';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { withValidation, type ValidatePolicy } from '@emdash/wire';
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

  const childHost = new ChildAcpProcessHost();
  const logger = initProcessLogging({ name: 'acp-agents-runtime', env });
  const attachmentStore = new LocalAttachmentStore(attachmentsDir);

  void serveProcessRuntime(
    (scope) => {
      const homeDir = os.homedir();
      const agentHost = new AgentPluginHost({
        scope,
        registry: options.pluginRegistry,
        exec: new NodeExecutionContext({ env }),
        fs: createLocalPluginFs(homeDir),
        env,
        homeDir,
      });
      const acp = new AcpRuntime({
        agentHost,
        host: childHost,
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
    { port: options.port, exit: options.exit, logger }
  ).catch((error: unknown) => {
    logger.error('ACP runtime process failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    (options.exit ?? process.exit)(1);
  });
}

function runtimeWireValidationPolicy(env: NodeJS.ProcessEnv): ValidatePolicy {
  return env.NODE_ENV === 'production' ? 'inputs' : 'full';
}

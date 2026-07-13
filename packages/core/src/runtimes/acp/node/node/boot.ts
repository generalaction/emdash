import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { initProcessLogging } from '@emdash/shared/logger/node';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { validation } from '@emdash/wire/api';
import { serveWireWorker, workerValidatePolicy, type WorkerParentPort } from '@emdash/wire/worker';
import { acpApiContract } from '@runtimes/acp/api';
import { createAcpController } from '@runtimes/acp/node/api/controller';
import { AcpRuntime } from '@runtimes/acp/node/runtime/runtime';
import type { AcpRuntimeDeps } from '@runtimes/acp/node/runtime/types';
import { AgentPluginHost, type CLIAgentPluginProvider } from '@services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '@services/exec/api';
import { ChildAcpProcessHost } from './child-process-host';
import { LocalAttachmentStore } from './local-attachment-store';

export type BootAcpRuntimeProcessOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  port?: WorkerParentPort;
  exit?: (code: number) => void;
};

export function bootAcpRuntimeProcess(options: BootAcpRuntimeProcessOptions): void {
  const env = options.env ?? process.env;
  const logger = initProcessLogging({ name: 'acp-agents-runtime', env });

  void serveWireWorker(
    ({ scope }) => {
      const attachmentsDir = env.EMDASH_ACP_ATTACHMENTS_DIR;
      if (!attachmentsDir) {
        throw new Error('ACP runtime process started without EMDASH_ACP_ATTACHMENTS_DIR');
      }

      const childHost = new ChildAcpProcessHost();
      const attachmentStore = new LocalAttachmentStore(attachmentsDir);
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
      return createAcpController(acp);
    },
    {
      port: options.port,
      exit: options.exit,
      logger,
      middleware: [validation(acpApiContract, workerValidatePolicy(env))],
    }
  );
}

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { defineWireComponent } from '@emdash/wire/component';
import { z } from 'zod';
import { acpApiContract } from '@runtimes/acp/api';
import { createAcpController } from '@runtimes/acp/node/api/controller';
import { ChildAcpProcessHost } from '@runtimes/acp/node/node/child-process-host';
import { LocalAttachmentStore } from '@runtimes/acp/node/node/local-attachment-store';
import { AcpRuntime } from '@runtimes/acp/node/runtime/runtime';
import type { AcpRuntimeDeps } from '@runtimes/acp/node/runtime/types';
import {
  AgentPluginHost,
  buildDescriptorFromProvider,
  type CLIAgentPluginProvider,
} from '@services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '@services/exec/api';
import { HostDependencyManager } from '@services/host-dependencies/node';

export const acpComponentConfigSchema = z.object({
  attachmentsDir: z.string().min(1),
});

export type CreateAcpComponentOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
};

export function createAcpComponent(options: CreateAcpComponentOptions) {
  return defineWireComponent({
    id: 'acp',
    contract: acpApiContract,
    requirements: {},
    configSchema: acpComponentConfigSchema,
    create: ({ config, instance, logger, scope }) => {
      const env = options.env ?? process.env;
      const runtimeLogger = options.logger ?? logger;
      const childHost = new ChildAcpProcessHost();
      const attachmentStore = new LocalAttachmentStore(config.attachmentsDir);
      const homeDir = os.homedir();
      const exec = new NodeExecutionContext({ env });
      const dependencyDescriptors = options.pluginRegistry.getAll().map(buildDescriptorFromProvider);
      const dependencyManager = new HostDependencyManager(exec, {
        dependencies: dependencyDescriptors,
        getDependencyDescriptor: (id) =>
          dependencyDescriptors.find((descriptor) => descriptor.id === id),
        logger: scope.log,
      });
      const agentHost = new AgentPluginHost({
        scope,
        registry: options.pluginRegistry,
        exec,
        dependencies: dependencyManager,
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
        logger: runtimeLogger,
      } satisfies AcpRuntimeDeps);

      scope.add(() => acp.dispose());
      return instance({
        scope,
        controller: createAcpController(acp),
      });
    },
  });
}

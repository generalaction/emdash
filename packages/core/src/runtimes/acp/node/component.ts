import os from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { defineWireComponent, requireContract } from '@emdash/wire/worker';
import { z } from 'zod';
import { acpApiContract } from '#runtimes/acp/api';
import { createAcpController } from '#runtimes/acp/node/api/controller';
import { ChildAcpProcessHost } from '#runtimes/acp/node/node/child-process-host';
import { AcpRuntime } from '#runtimes/acp/node/runtime/runtime';
import type { AcpRuntimeDeps } from '#runtimes/acp/node/runtime/types';
import { AgentPluginHost, type CLIAgentPluginProvider } from '#services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '#services/agent-plugins/api/plugins/helpers';
import { conversationAttachmentsContract } from '#services/attachments/api';
import { conversationReportsContract } from '#services/conversation-reports/api';
import { createConversationLifecycleReporter } from '#services/conversation-reports/node';
import { NodeExecutionContext } from '#services/exec/api';
import {
  createHostDependencyResolverFromDependency,
  hostDependencyResolverContract,
} from '#services/host-dependencies/node';
import {
  createFileSessionIntentStore,
  createNoopSessionIntentStore,
} from '#services/session-intents/node';
import { idlePolicyConfigSchema } from '#services/session-lifecycle/api';
import { userShellEnvContract } from '#services/shell-env/api';

export const acpComponentConfigSchema = z.object({
  intentsFilePath: z.string().min(1).optional(),
  lifecycle: z
    .object({
      session: idlePolicyConfigSchema.optional(),
      sweepIntervalMs: z.number().int().positive().optional(),
      connectionIdleTtlMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export type CreateAcpComponentOptions = {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  logger?: Logger;
};

export function createAcpComponent(options: CreateAcpComponentOptions) {
  return defineWireComponent({
    id: 'acp',
    contract: acpApiContract,
    requirements: {
      hostDependencies: requireContract(hostDependencyResolverContract),
      conversations: requireContract(conversationReportsContract),
      attachments: requireContract(conversationAttachmentsContract),
      userEnv: requireContract(userShellEnvContract),
    },
    configSchema: acpComponentConfigSchema,
    create: ({ config, dependencies, instance, logger, scope }) => {
      const env = () => dependencies.userEnv.get();
      const runtimeLogger = options.logger ?? logger;
      const childHost = new ChildAcpProcessHost();
      const homeDir = os.homedir();
      const exec = new NodeExecutionContext({ env });
      const dependencyResolver = createHostDependencyResolverFromDependency(
        dependencies.hostDependencies
      );
      const intents = config.intentsFilePath
        ? createFileSessionIntentStore({ path: config.intentsFilePath, scope: 'acp' })
        : createNoopSessionIntentStore();
      const agentHost = new AgentPluginHost({
        scope,
        registry: options.pluginRegistry,
        exec,
        dependencies: dependencyResolver,
        fs: createLocalPluginFs(homeDir),
        env,
        homeDir,
      });
      const acp = new AcpRuntime({
        agentHost,
        host: childHost,
        resolveAttachment: async (conversationId, attachment) => {
          const stored = await dependencies.attachments.attachments.download({
            conversationId,
            attachmentId: attachment.id,
          });
          if (!stored.success) throw new Error(stored.error.message);
          return {
            data: Buffer.from(await stored.data.bytes()).toString('base64'),
            mimeType: stored.data.meta.mimeType,
          };
        },
        intents,
        conversationReports: createConversationLifecycleReporter({
          client: dependencies.conversations,
          logger: runtimeLogger,
        }),
        lifecycle: config.lifecycle,
        logger: runtimeLogger,
      } satisfies AcpRuntimeDeps);
      void acp.reconcile();

      scope.add(() => acp.dispose());
      return instance({
        scope,
        controller: createAcpController(acp),
      });
    },
  });
}

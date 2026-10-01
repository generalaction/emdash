import { defineWireComponent, requireContract } from '@emdash/wire/worker';
import { z } from 'zod';
import { hostDependencyResolverContract } from '#services/host-dependencies/api';
import { createHostDependencyResolverFromDependency } from '#services/host-dependencies/node/process-resolver-client';
import { userShellEnvContract } from '#services/shell-env/api';
import { lspContract } from '../api/contract';
import { createLspController } from './controller';
import { LspRuntime } from './runtime';
import { resolveLanguageServer } from './server-registry';

export const lspComponent = defineWireComponent({
  id: 'lsp',
  contract: lspContract,
  requirements: {
    userEnv: requireContract(userShellEnvContract),
    hostDependencies: requireContract(hostDependencyResolverContract),
  },
  configSchema: z.object({}),
  create: ({ dependencies, instance, scope }) => {
    const resolver = createHostDependencyResolverFromDependency(dependencies.hostDependencies);
    const runtime = new LspRuntime({
      scope,
      resolveServer: async (key) =>
        resolveLanguageServer(key.serverId, resolver, await dependencies.userEnv.get()),
    });
    return instance({ scope, controller: createLspController(runtime) });
  },
});

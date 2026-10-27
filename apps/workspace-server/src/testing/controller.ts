import { acpApiContract } from '@agent/core/runtimes/acp/api';
import { agentConfigContract } from '@agent/core/runtimes/agent-config/api';
import { automationsContract } from '@agent/core/runtimes/automations/api';
import { conversationsContract } from '@agent/core/runtimes/conversations/api';
import { fileSearchContract } from '@agent/core/runtimes/file-search/api';
import { filesContract } from '@agent/core/runtimes/files/api';
import { gitContract } from '@agent/core/runtimes/git/api';
import { hostSettingsContract } from '@agent/core/runtimes/host-settings/api';
import { lspContract } from '@agent/core/runtimes/lsp/api';
import { providerUsageContract } from '@agent/core/runtimes/provider-usage/api';
import { resourceUsageContract } from '@agent/core/runtimes/resource-usage/api';
import { scriptsContract } from '@agent/core/runtimes/scripts/api';
import { terminalsContract } from '@agent/core/runtimes/terminals/api';
import { tuiAgentsContract } from '@agent/core/runtimes/tui-agents/api';
import { workspaceRegistryContract } from '@agent/core/runtimes/workspace-registry/api';
import { hostDependenciesContract } from '@agent/core/services/host-dependencies/api';
import { client } from '@agent/wire/rpc';
import type { Connection, Contract, ContractClient, ContractDefinitions } from '@agent/wire/rpc';
import { createWorkspaceWireController, type WorkspaceWireControllerDeps } from '../api/controller';
import type { WorkspaceServerRuntimeClients } from '../gateway/workspace-workers';

type ControllerMetadata = Partial<
  Pick<WorkspaceWireControllerDeps, 'appVersion' | 'daemonId' | 'startedAt'>
>;

export function createTestWorkspaceWireController(
  runtimes: Partial<WorkspaceServerRuntimeClients> = {},
  metadata: ControllerMetadata = {}
) {
  return createWorkspaceWireController({
    ...metadata,
    runtimes: createTestRuntimeClients(runtimes),
    hostDependencies: createDisconnectedClient(hostDependenciesContract),
  });
}

export function createTestRuntimeClients(
  overrides: Partial<WorkspaceServerRuntimeClients> = {}
): WorkspaceServerRuntimeClients {
  return {
    acp: createDisconnectedClient(acpApiContract),
    providerUsage: createDisconnectedClient(providerUsageContract),
    agentConfig: createDisconnectedClient(agentConfigContract),
    automations: createDisconnectedClient(automationsContract),
    conversations: createDisconnectedClient(conversationsContract),
    fileSearch: createDisconnectedClient(fileSearchContract),
    files: createDisconnectedClient(filesContract),
    git: createDisconnectedClient(gitContract),
    hostSettings: createDisconnectedClient(hostSettingsContract),
    lsp: createDisconnectedClient(lspContract),
    resourceUsage: createDisconnectedClient(resourceUsageContract),
    scripts: createDisconnectedClient(scriptsContract),
    terminals: createDisconnectedClient(terminalsContract),
    tuiAgents: createDisconnectedClient(tuiAgentsContract),
    workspaceRegistry: createDisconnectedClient(workspaceRegistryContract),
    ...overrides,
  };
}

function createDisconnectedClient<Defs extends ContractDefinitions>(
  contract: Contract<Defs>
): ContractClient<Defs> {
  return client(contract, disconnectedConnection);
}

const disconnectedConnection: Connection = {
  call: async () => {
    throw new Error('Test runtime client is not connected');
  },
  openBlobConsumer: () => {
    throw new Error('Test runtime client is not connected');
  },
  openBlobProducer: () => {
    throw new Error('Test runtime client is not connected');
  },
  snapshot: async () => {
    throw new Error('Test runtime client is not connected');
  },
  attach: async () => {
    throw new Error('Test runtime client is not connected');
  },
  onDisconnect: () => () => {},
  dispose: () => {},
};

import type { HostDependenciesContract } from '@emdash/core/services/host-dependencies/node';
import type { ContractClient } from '@emdash/wire/api';
import { hostDependenciesClient } from '@main/gateway/desktop-workers';

export type HostDependenciesClient = ContractClient<HostDependenciesContract>;

export const localDependencyManager = hostDependenciesClient;

export async function getDependencyManager(connectionId?: string): Promise<HostDependenciesClient> {
  if (!connectionId) return localDependencyManager;
  throw new Error('Remote host dependencies require the workspace server.');
}

export async function ensureAgentDependenciesProbed(
  manager: HostDependenciesClient,
  _options: { refreshShellEnv?: boolean } = { refreshShellEnv: true }
): Promise<void> {
  await manager.snapshot.mutate('refresh', { key: undefined, input: {} });
}

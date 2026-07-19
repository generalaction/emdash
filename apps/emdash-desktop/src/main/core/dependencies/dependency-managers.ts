import type { HostDependenciesContract } from '@emdash/core/services/host-dependencies/node';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/api';
import { remoteRuntimeUnavailable } from '@core/features/runtime-routing/api';
import { hostDependenciesClient } from '@main/gateway/desktop-workers';

export type HostDependenciesClient = ContractClient<HostDependenciesContract>;

export const localDependencyManager = hostDependenciesClient;

export async function getDependencyManager(
  connectionId?: string
): Promise<Result<HostDependenciesClient, RuntimeResolveError>> {
  if (!connectionId) return ok(localDependencyManager);
  return err(remoteRuntimeUnavailable(connectionId, 'host-dependencies'));
}

export async function ensureAgentDependenciesProbed(
  manager: HostDependenciesClient,
  _options: { refreshShellEnv?: boolean } = { refreshShellEnv: true }
): Promise<void> {
  await manager.snapshot.mutate('refresh', { key: undefined, input: {} });
}

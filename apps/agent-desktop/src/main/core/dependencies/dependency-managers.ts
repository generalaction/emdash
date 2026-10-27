import type { HostDependenciesContract } from '@agent/core/services/host-dependencies/node';
import type { RuntimeResolveError } from '@agent/core/services/runtime-broker/api';
import { err, ok, type Result } from '@agent/shared';
import type { ContractClient } from '@agent/wire/rpc';
import { remoteRuntimeUnavailable } from '@core/primitives/desktop-runtime/api/runtime-errors';

export type HostDependenciesClient = ContractClient<HostDependenciesContract>;

export function createDependencyManagerResolver(localDependencyManager: HostDependenciesClient) {
  return async function getDependencyManager(
    connectionId?: string
  ): Promise<Result<HostDependenciesClient, RuntimeResolveError>> {
    if (!connectionId) return ok(localDependencyManager);
    return err(remoteRuntimeUnavailable(connectionId, 'host-dependencies'));
  };
}

const pendingRefreshes = new WeakMap<HostDependenciesClient, Promise<void>>();

export function ensureAgentDependenciesProbed(
  manager: HostDependenciesClient,
  _options: { refreshShellEnv?: boolean } = { refreshShellEnv: true }
): Promise<void> {
  const pending = pendingRefreshes.get(manager);
  if (pending) return pending;
  const refresh = manager.snapshot
    .mutate('refresh', { key: undefined, input: {} })
    .then((result) => {
      if (!result.success) throw new Error(JSON.stringify(result.error));
    })
    .finally(() => pendingRefreshes.delete(manager));
  pendingRefreshes.set(manager, refresh);
  return refresh;
}

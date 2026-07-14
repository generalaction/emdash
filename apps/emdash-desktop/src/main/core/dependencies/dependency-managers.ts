import {
  createHostDependenciesComponent,
  type HostDependenciesContract,
} from '@emdash/core/services/host-dependencies/node';
import type { ContractClient } from '@emdash/wire/api';
import { appScope } from '@main/app/app-scope';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { hostDependenciesClient } from '@main/core/wire-workers/desktop-workers';
import { desktopKeyValueStore } from '@main/db/kv';
import { DEPENDENCIES } from './registry';

export type HostDependenciesClient = ContractClient<HostDependenciesContract>;

const scope = appScope.child('host-dependencies');
const sshManagers = new Map<string, HostDependenciesClient>();
const sshManagerPromises = new Map<string, Promise<HostDependenciesClient>>();

export const localDependencyManager = hostDependenciesClient;

export async function getDependencyManager(connectionId?: string): Promise<HostDependenciesClient> {
  if (!connectionId) return localDependencyManager;
  const existing = sshManagers.get(connectionId);
  if (existing) return existing;

  const pending = sshManagerPromises.get(connectionId);
  if (pending) return pending;

  const promise = createSshDependencyManager(connectionId)
    .then((manager) => {
      if (sshManagerPromises.get(connectionId) === promise) {
        sshManagers.set(connectionId, manager);
      }
      return manager;
    })
    .finally(() => {
      if (sshManagerPromises.get(connectionId) === promise) {
        sshManagerPromises.delete(connectionId);
      }
    });
  sshManagerPromises.set(connectionId, promise);
  return promise;
}

async function createSshDependencyManager(connectionId: string): Promise<HostDependenciesClient> {
  const proxy = await sshConnectionManager.connect(connectionId);
  const sshCtx = new SshExecutionContext(proxy);
  const instance = createHostDependenciesComponent({
    store: desktopKeyValueStore,
    exec: sshCtx,
  }).create({
    scope,
    dependencies: {},
    config: {
      hostId: connectionId,
      definitions: DEPENDENCIES,
    },
  });
  return instance.client;
}

export function clearDependencyManager(connectionId: string): void {
  sshManagers.delete(connectionId);
  sshManagerPromises.delete(connectionId);
}

export async function ensureAgentDependenciesProbed(
  manager: HostDependenciesClient,
  _options: { refreshShellEnv?: boolean } = { refreshShellEnv: true }
): Promise<void> {
  await manager.snapshot.mutate('refresh', { key: undefined, input: {} });
}

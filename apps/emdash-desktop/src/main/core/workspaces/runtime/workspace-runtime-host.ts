import { mkdirSync } from 'node:fs';
import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { hostFileRef, type HostFileRef } from '@emdash/core/primitives/path/api';
import type { WorkspaceContract } from '@emdash/core/runtimes/workspace/api';
import { workspaceComponent } from '@emdash/core/runtimes/workspace/node';
import { fsWatchComponent } from '@emdash/core/services/fs-watch/node';
import { createScope } from '@emdash/shared/concurrency';
import type { ContractClient } from '@emdash/wire/api';
import type { WireComponentInstance } from '@emdash/wire/component';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { getTerminalsRuntimeClient } from '@main/gateway/accessors';
import { log } from '@main/lib/logger';
import { workspaceRuntimePaths } from './workspace-runtime-paths';

export type WorkspaceRuntimeClient = ContractClient<WorkspaceContract>;

type WorkspaceRuntimeHost = {
  scope: ReturnType<typeof createScope>;
  instance: WireComponentInstance<WorkspaceContract>;
  client: WorkspaceRuntimeClient;
};

let host: WorkspaceRuntimeHost | undefined;
let hostPromise: Promise<WorkspaceRuntimeHost> | undefined;

export async function getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient> {
  return (await ensureHost()).client;
}

export function hostFileRefFromNativePath(path: string, connectionId?: string): HostFileRef {
  const host = connectionId ? hostRef('remote', connectionId) : LOCAL_HOST_REF;
  return hostFileRef(host, hostPathFromNative(path));
}

export function disposeWorkspaceRuntimeHost(): Promise<void> {
  const current = host;
  host = undefined;
  hostPromise = undefined;
  return current?.scope.dispose() ?? Promise.resolve();
}

function ensureHost(): Promise<WorkspaceRuntimeHost> {
  if (host) return Promise.resolve(host);
  hostPromise ??= createHost();
  return hostPromise;
}

async function createHost(): Promise<WorkspaceRuntimeHost> {
  const scope = createScope({ label: 'workspace-runtime' });
  const { worktreePoolPath } = workspaceRuntimePaths();
  mkdirSync(worktreePoolPath, { recursive: true });
  const terminals = await getTerminalsRuntimeClient();
  const watcher = fsWatchComponent.create({
    scope,
    dependencies: {},
    config: {},
    validate: 'inputs',
  });
  const instance = workspaceComponent.create({
    scope,
    dependencies: {
      terminals,
      watcher: watcher.client,
    },
    config: {
      provisioning: {
        worktreePoolPath,
        baseRemote: 'origin',
      },
    },
    logger: log,
    validate: 'inputs',
  });

  host = {
    scope,
    instance,
    client: instance.client,
  };
  return host;
}

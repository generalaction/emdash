import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { hostFileRef, type HostFileRef } from '@emdash/core/primitives/path/api';
import { workspaceContract, type WorkspaceContract } from '@emdash/core/runtimes/workspace/api';
import { createWorkspaceController, WorkspaceRuntime } from '@emdash/core/runtimes/workspace/node';
import { createScope } from '@emdash/shared/concurrency';
import { client, connect, memoryTransportPair, serve, type ContractClient } from '@emdash/wire/api';
import { log } from '@main/lib/logger';
import { hostPathFromNative } from '@shared/core/runtime/paths';

export type WorkspaceRuntimeClient = ContractClient<WorkspaceContract>;

type WorkspaceRuntimeHost = {
  scope: ReturnType<typeof createScope>;
  pair: ReturnType<typeof memoryTransportPair>;
  controller: ReturnType<typeof createWorkspaceController>;
  stopServing: () => void;
  client: WorkspaceRuntimeClient;
};

let host: WorkspaceRuntimeHost | undefined;

export function getWorkspaceRuntimeClient(): WorkspaceRuntimeClient {
  return ensureHost().client;
}

export function hostFileRefFromNativePath(path: string, connectionId?: string): HostFileRef {
  const host = connectionId ? hostRef('remote', connectionId) : LOCAL_HOST_REF;
  return hostFileRef(host, hostPathFromNative(path));
}

export function disposeWorkspaceRuntimeHost(): Promise<void> {
  const current = host;
  host = undefined;
  return current?.scope.dispose() ?? Promise.resolve();
}

function ensureHost(): WorkspaceRuntimeHost {
  if (host) return host;

  const scope = createScope({ label: 'workspace-runtime' });
  const runtime = new WorkspaceRuntime({
    scope,
    onError: (context, error) => log.warn(`Workspace runtime ${context}`, { error }),
  });
  const pair = memoryTransportPair();
  const controller = createWorkspaceController(runtime, { validate: 'inputs' });
  const stopServing = serve(pair.right, controller);

  scope.add(async () => {
    stopServing();
    await controller.dispose?.();
    pair.disconnect();
  });

  host = {
    scope,
    pair,
    controller,
    stopServing,
    client: client(workspaceContract, connect(pair.left)),
  };
  return host;
}

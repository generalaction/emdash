import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import { previewServerService } from '@core/features/preview-servers/api/node/preview-server-service-instance';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { appScope } from '@main/bootstrap/core/app-scope';
import {
  createDevServerBridge,
  type DevServerBridge,
} from '@main/core/preview-servers/dev-server-bridge';

type DevServerBridgeInstallerOptions = {
  readonly scope: Scope;
  readonly runtimes: Pick<RuntimeBroker, 'session'>;
  readonly createBridge: (
    client: Parameters<typeof createDevServerBridge>[0]
  ) => Promise<DevServerBridge>;
};

export function createDevServerBridgeInstaller({
  scope,
  runtimes,
  createBridge,
}: DevServerBridgeInstallerOptions): () => Promise<void> {
  let installed = false;
  let installing: Promise<void> | undefined;

  return function install(): Promise<void> {
    if (installed) return Promise.resolve();
    if (installing) return installing;

    const attemptScope = scope.child('installation');
    installing = (async () => {
      try {
        // The bridge observes local terminal output for the app lifetime, so this lease
        // intentionally pins the local broker session until the main scope is disposed.
        const lease = runtimes.session(LOCAL_HOST_REF);
        attemptScope.add(() => lease.release());

        const runtime = await lease.ready();
        if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);

        const bridge = await createBridge(runtime.data.terminals);
        attemptScope.add(() => bridge.dispose());
        if (attemptScope.disposed) {
          throw new Error('Dev-server bridge installation was disposed before it completed');
        }
        installed = true;
      } catch (error) {
        await attemptScope.dispose(error);
        throw error;
      }
    })().finally(() => {
      installing = undefined;
    });
    return installing;
  };
}

const bridgeScope = appScope.child('dev-server-bridge');

export function createDesktopDevServerBridgeInstaller(
  runtimes: Pick<RuntimeBroker, 'session'>,
  workspaceIdentity: Pick<WorkspaceIdentityService, 'findByPath'>
): () => Promise<void> {
  return createDevServerBridgeInstaller({
    scope: bridgeScope,
    runtimes,
    createBridge: (client) =>
      createDevServerBridge(client, {
        previewServers: previewServerService,
        resolveWorkspace: (workspacePath, host) =>
          workspaceIdentity.findByPath(workspacePath, host),
      }),
  });
}

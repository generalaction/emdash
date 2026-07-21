import {
  hostRef,
  hostRefEquals,
  LOCAL_HOST_REF,
  sshConnectionIdOf,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import {
  RuntimeBroker,
  runtimeHostNotConfigured,
  runtimeHostUnavailable,
  type HostRuntimesClient,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { WorkspaceServerServiceHandle } from '@core/services/workspace-server/node';
import { appScope } from '@main/bootstrap/core/app-scope';
import {
  getAcpRuntimeClient,
  getAgentConfigRuntimeClient,
  getFileSearchRuntimeClient,
  getFilesRuntimeClient,
  getGitRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
  getWorkspaceRuntimeClient,
  hostDependenciesClient,
} from './desktop-workers';

export function createDesktopRuntimeBroker(
  scope: Scope,
  remoteRuntimes?: WorkspaceServerServiceHandle
): RuntimeBroker {
  return new RuntimeBroker({
    scope,
    idleTtlMs: 30_000,
    resolve: (host, sessionScope) =>
      resolveDesktopRuntimeSession(host, sessionScope, remoteRuntimes ?? configuredRemoteRuntimes),
  });
}

let sharedBroker: RuntimeBroker | undefined;
let configuredRemoteRuntimes: WorkspaceServerServiceHandle | undefined;
let stopRemoteInvalidation: (() => void) | undefined;

export function getDesktopRuntimeBroker(): RuntimeBroker {
  sharedBroker ??= createDesktopRuntimeBroker(appScope.child('runtime-broker'));
  return sharedBroker;
}

export function configureRemoteRuntimes(handle: WorkspaceServerServiceHandle): () => void {
  stopRemoteInvalidation?.();
  configuredRemoteRuntimes = handle;
  const stop = handle.onInvalidate(({ connectionId }) => {
    void getDesktopRuntimeBroker().invalidate(hostRef('remote', connectionId));
  });
  stopRemoteInvalidation = stop;

  return () => {
    if (configuredRemoteRuntimes !== handle) return;
    stop();
    stopRemoteInvalidation = undefined;
    configuredRemoteRuntimes = undefined;
  };
}

async function resolveDesktopRuntimeSession(
  host: HostRef,
  scope: Scope,
  remoteRuntimes: WorkspaceServerServiceHandle | undefined
): Promise<Result<HostRuntimesClient, RuntimeResolveError>> {
  if (!hostRefEquals(host, LOCAL_HOST_REF)) {
    const connectionId = sshConnectionIdOf(host);
    if (connectionId && remoteRuntimes) {
      try {
        const lease = await remoteRuntimes.acquireConnection(connectionId);
        scope.add(() => lease.release());
        const connection = await lease.ready();
        return ok(connection.client);
      } catch (error) {
        return err(
          runtimeHostUnavailable(
            host,
            error instanceof Error ? error.message : 'Remote workspace server is unavailable'
          )
        );
      }
    }
    return err(
      host.type === 'remote'
        ? runtimeHostUnavailable(host, 'Remote runtime sessions are not enabled')
        : runtimeHostNotConfigured(host, `Local runtime host '${host.id}' is not configured`)
    );
  }

  const [git, fileSearch, files, acp, tuiAgents, agentConfig, terminals, workspace] =
    await Promise.all([
      getGitRuntimeClient(),
      getFileSearchRuntimeClient(),
      getFilesRuntimeClient(),
      getAcpRuntimeClient(),
      getTuiAgentsRuntimeClient(),
      getAgentConfigRuntimeClient(),
      getTerminalsRuntimeClient(),
      getWorkspaceRuntimeClient(),
    ]);

  return ok({
    git,
    fileSearch,
    files,
    acp,
    tuiAgents,
    agentConfig,
    terminals,
    workspace,
    hostDependencies: hostDependenciesClient,
  });
}

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
import type { DesktopRuntimeClients } from './desktop-workers';

export function createDesktopRuntimeBroker(
  scope: Scope,
  clients: DesktopRuntimeClients,
  remoteRuntimes: WorkspaceServerServiceHandle
): RuntimeBroker {
  const broker = new RuntimeBroker({
    scope,
    idleTtlMs: 30_000,
    resolve: (host, sessionScope) =>
      resolveDesktopRuntimeSession(host, sessionScope, clients, remoteRuntimes),
  });
  scope.add(
    remoteRuntimes.onInvalidate(({ connectionId }) => {
      void broker.invalidate(hostRef('remote', connectionId));
    })
  );
  return broker;
}

async function resolveDesktopRuntimeSession(
  host: HostRef,
  scope: Scope,
  clients: DesktopRuntimeClients,
  remoteRuntimes: WorkspaceServerServiceHandle
): Promise<Result<HostRuntimesClient, RuntimeResolveError>> {
  if (!hostRefEquals(host, LOCAL_HOST_REF)) {
    const connectionId = sshConnectionIdOf(host);
    if (connectionId) {
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

  return ok({
    git: clients.git,
    fileSearch: clients.fileSearch,
    files: clients.files,
    acp: clients.acp,
    tuiAgents: clients.tuiAgents,
    agentConfig: clients.agentConfig,
    terminals: clients.terminals,
    workspace: clients.workspace,
    hostDependencies: clients.hostDependencies,
  });
}

import {
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
import type { WorkspaceServerServiceHandle } from '@core/services/workspace-server/node';
import type { DesktopRuntimeClients } from './desktop-workers';

export function createDesktopRuntimeBroker(
  clients: DesktopRuntimeClients,
  remoteRuntimes: WorkspaceServerServiceHandle
): RuntimeBroker {
  return new RuntimeBroker({
    resolve: (host) => resolveDesktopRuntimeClient(host, clients, remoteRuntimes),
  });
}

async function resolveDesktopRuntimeClient(
  host: HostRef,
  clients: DesktopRuntimeClients,
  remoteRuntimes: WorkspaceServerServiceHandle
): Promise<Result<HostRuntimesClient, RuntimeResolveError>> {
  if (!hostRefEquals(host, LOCAL_HOST_REF)) {
    const connectionId = sshConnectionIdOf(host);
    if (connectionId) {
      try {
        const connection = await remoteRuntimes.client(connectionId);
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
    automations: clients.automations,
    tuiAgents: clients.tuiAgents,
    agentConfig: clients.agentConfig,
    terminals: clients.terminals,
    workspace: clients.workspace,
    resourceUsage: clients.resourceUsage,
    hostDependencies: clients.hostDependencies,
  });
}

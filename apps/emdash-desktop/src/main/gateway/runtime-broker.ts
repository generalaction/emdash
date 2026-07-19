import { hostRefEquals, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import {
  RuntimeBroker,
  runtimeHostNotConfigured,
  runtimeHostUnavailable,
  type HostRuntimesClient,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { appScope } from '@main/bootstrap/app-scope';
import {
  getAcpRuntimeClient,
  getAgentConfigRuntimeClient,
  getFilesRuntimeClient,
  getGitRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
  getWorkspaceRuntimeClient,
  hostDependenciesClient,
} from './desktop-workers';

export function createDesktopRuntimeBroker(scope: Scope): RuntimeBroker {
  return new RuntimeBroker({
    scope,
    idleTtlMs: 30_000,
    resolve: resolveDesktopRuntimeSession,
  });
}

let sharedBroker: RuntimeBroker | undefined;

export function getDesktopRuntimeBroker(): RuntimeBroker {
  sharedBroker ??= createDesktopRuntimeBroker(appScope.child('runtime-broker'));
  return sharedBroker;
}

async function resolveDesktopRuntimeSession(
  host: HostRef
): Promise<Result<HostRuntimesClient, RuntimeResolveError>> {
  if (!hostRefEquals(host, LOCAL_HOST_REF)) {
    return err(
      host.type === 'remote'
        ? runtimeHostUnavailable(host, 'Remote runtime sessions are not enabled')
        : runtimeHostNotConfigured(host, `Local runtime host '${host.id}' is not configured`)
    );
  }

  const [git, files, acp, tuiAgents, agentConfig, terminals, workspace] = await Promise.all([
    getGitRuntimeClient(),
    getFilesRuntimeClient(),
    getAcpRuntimeClient(),
    getTuiAgentsRuntimeClient(),
    getAgentConfigRuntimeClient(),
    getTerminalsRuntimeClient(),
    getWorkspaceRuntimeClient(),
  ]);

  return ok({
    git,
    files,
    acp,
    tuiAgents,
    agentConfig,
    terminals,
    workspace,
    hostDependencies: hostDependenciesClient,
  });
}

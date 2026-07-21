import { sshConnectionIdOf, type HostRef } from '@emdash/core/primitives/host/api';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import type { LeasedLiveModelProvider, LiveSource } from '@emdash/wire';
import { createController, type CallMeta, type Controller } from '@emdash/wire/api';
import type { AgentOperations } from '@core/features/agents/node/controller';
import { agentsContract } from '../api';
import {
  throwAgentsRuntimeResolveError,
  type AgentsDependencyId as DependencyId,
  type AgentsHostRuntimesClient as HostRuntimesClient,
  type AgentsRuntimeBroker,
  type AgentsRuntimeResolveError as RuntimeResolveError,
} from '../api/runtime-adapter';

export type CreateAgentsWireControllerOptions = Readonly<{
  operations: AgentOperations;
  runtimes: AgentsRuntimeBroker;
}>;

export function createAgentsWireController(options: CreateAgentsWireControllerOptions): Controller {
  const agentOperations = options.operations;
  return createController(agentsContract, {
    list: ({ host }) =>
      withHostRuntime(options.runtimes, host, (runtime) =>
        agentOperations.list(sshConnectionIdOf(host), runtime.hostDependencies)
      ),
    get: ({ host, id }) =>
      withHostRuntime(options.runtimes, host, (runtime) =>
        agentOperations.get(id, sshConnectionIdOf(host), runtime.hostDependencies)
      ),
    listAgentInstallationStatus: ({ host }) =>
      withHostRuntime(options.runtimes, host, (runtime) =>
        agentOperations.listAgentInstallationStatus(
          sshConnectionIdOf(host),
          runtime.hostDependencies
        )
      ),
    install: ({ host, id, method }) =>
      withHostRuntime(options.runtimes, host, () =>
        agentOperations.install(id as AgentProviderId, sshConnectionIdOf(host), method)
      ),
    update: ({ host, id, method }) =>
      withHostRuntime(options.runtimes, host, () =>
        agentOperations.update(id as AgentProviderId, sshConnectionIdOf(host), method)
      ),
    uninstall: ({ host, id, method }) =>
      withHostRuntime(options.runtimes, host, () =>
        agentOperations.uninstall(id as AgentProviderId, sshConnectionIdOf(host), method)
      ),
    getDefaultSettings: ({ host, id }) =>
      withHostRuntime(options.runtimes, host, () => agentOperations.getDefaultSettings(id)),
    getSettings: ({ host, id }) =>
      withHostRuntime(options.runtimes, host, () => agentOperations.getSettings(id)),
    updateSettings: ({ host, id, config }) =>
      withHostRuntime(options.runtimes, host, () => agentOperations.updateSettings(id, config)),
    setUsedInstallation: ({ host, id, selection }) =>
      withHostRuntime(options.runtimes, host, (runtime) =>
        agentOperations.setUsedInstallation(
          id as DependencyId,
          sshConnectionIdOf(host),
          selection,
          runtime.hostDependencies
        )
      ),
    probeOverride: ({ host, id, selection }) =>
      withHostRuntime(options.runtimes, host, () =>
        agentOperations.probeOverride(id as DependencyId, selection, sshConnectionIdOf(host))
      ),
    refreshLatestVersion: ({ host, id }) =>
      withHostRuntime(options.runtimes, host, () =>
        agentOperations.refreshLatestVersion(id as DependencyId, sshConnectionIdOf(host))
      ),
    probeAll: ({ host }) =>
      withHostRuntime(options.runtimes, host, (runtime) =>
        agentOperations.probeAll(sshConnectionIdOf(host), runtime.hostDependencies)
      ),

    auth: createAuthModelProvider(options.runtimes),
    refreshAgents: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.refreshAgents(withoutHost(input), callOptions(meta))
      ),
    startLogin: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.startLogin(withoutHost(input), callOptions(meta))
      ),
    cancelLogin: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.cancelLogin(withoutHost(input), callOptions(meta))
      ),
    sendLoginInput: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.sendLoginInput(withoutHost(input), callOptions(meta))
      ),
    resizeLogin: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.resizeLogin(withoutHost(input), callOptions(meta))
      ),
    markUrlHandled: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.markUrlHandled(withoutHost(input), callOptions(meta))
      ),
    refreshAuthStatus: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.refreshAuthStatus(withoutHost(input), callOptions(meta))
      ),
    loginOutput: ({ host, providerId }) =>
      leasedLiveSource(() =>
        acquireRuntimeSource(options.runtimes, host, (runtime) =>
          runtime.agentConfig.loginOutput.handle({ providerId }).asLiveSource()
        )
      ),
  });
}

function createAuthModelProvider(
  runtimes: AgentsRuntimeBroker
): LeasedLiveModelProvider<typeof agentsContract.auth> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: agentsContract.auth,
    acquireState: (key, name) =>
      acquireRuntimeSource(runtimes, key.host, (runtime) =>
        runtime.agentConfig.agents.state(undefined, name).asLiveSource()
      ),
    async runMutation() {
      throw new Error(`Live model '${agentsContract.auth.id}' has no mutations`);
    },
    async dispose() {},
  };
}

async function withHostRuntime<T>(
  runtimes: AgentsRuntimeBroker,
  host: HostRef,
  work: (client: HostRuntimesClient) => Promise<T> | T
): Promise<Result<T, RuntimeResolveError>> {
  const lease = runtimes.session(host);
  try {
    const runtime = await lease.ready();
    if (!runtime.success) return err(runtime.error);
    return ok(await work(runtime.data));
  } finally {
    await lease.release();
  }
}

async function withAgentConfigResult<T, E>(
  runtimes: AgentsRuntimeBroker,
  host: HostRef,
  work: (client: HostRuntimesClient['agentConfig']) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const lease = runtimes.session(host);
  try {
    const runtime = await lease.ready();
    if (!runtime.success) return err(runtime.error);
    return await work(runtime.data.agentConfig);
  } finally {
    await lease.release();
  }
}

function acquireRuntimeSource(
  runtimes: AgentsRuntimeBroker,
  host: HostRef,
  source: (client: HostRuntimesClient) => LiveSource
): PendingLease<LiveSource> {
  const lease = runtimes.session(host);
  const ready = lease.ready();
  return {
    async ready() {
      const runtime = await ready;
      if (!runtime.success) throwAgentsRuntimeResolveError(runtime.error);
      return source(runtime.data);
    },
    release: () => lease.release(),
  };
}

function leasedLiveSource(acquire: () => PendingLease<LiveSource>): LiveSource {
  return {
    async snapshot() {
      const lease = acquire();
      try {
        return await (await lease.ready()).snapshot();
      } finally {
        await lease.release();
      }
    },
    async subscribe(callback, options) {
      const lease = acquire();
      try {
        const unsubscribe = await (await lease.ready()).subscribe(callback, options);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try {
            unsubscribe();
          } finally {
            void lease.release();
          }
        };
      } catch (error) {
        await lease.release();
        throw error;
      }
    },
  };
}

function withoutHost<T extends { host: HostRef }>(input: T): Omit<T, 'host'> {
  const { host: _, ...rest } = input;
  return rest;
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}

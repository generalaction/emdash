import type {
  DependencyId,
  HostDependencyError,
  HostDependencySnapshot,
} from '@emdash/core/services/host-dependencies/node';
import { hostDependenciesContract } from '@emdash/core/services/host-dependencies/node';
import type { HostDependenciesContract } from '@emdash/core/services/host-dependencies/node';
import { runtimeResolveErrorAsError } from '@emdash/core/services/runtime-broker/api';
import type { AgentProviderId } from '@emdash/plugins/agents';
import type { Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/api';
import type { AgentInstallError, InstallMethod } from '@core/primitives/agents/api';
import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import { runRuntimeLiveJob } from '@core/services/runtime-clients/node/live-job';
import type { ProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import {
  buildAgentMetadataList,
  buildAgentPayload,
  buildAgentPayloads,
  toAgentInstallationStatus,
} from './agent-payload-builder';

export type HostDependenciesClient = ContractClient<HostDependenciesContract>;

export function createAgentOperations(dependencies: {
  ensureAgentDependenciesProbed(manager: HostDependenciesClient): Promise<void>;
  getDependencyManager(
    connectionId?: string
  ): Promise<Result<HostDependenciesClient, Parameters<typeof runtimeResolveErrorAsError>[0]>>;
  providerOverrideSettings: ProviderOverrideSettings;
}) {
  const { ensureAgentDependenciesProbed, getDependencyManager, providerOverrideSettings } =
    dependencies;
  return {
    // ── Metadata ────────────────────────────────────────────────────────────────

    list: async (connectionId?: string, manager?: HostDependenciesClient) => {
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      const snapshot = await snapshotFor(mgr, ensureAgentDependenciesProbed);
      return buildAgentPayloads(providerOverrideSettings, snapshot, connectionId);
    },

    get: async (id: string, connectionId?: string, manager?: HostDependenciesClient) => {
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      const snapshot = await snapshotFor(mgr, ensureAgentDependenciesProbed);
      return buildAgentPayload(providerOverrideSettings, id, snapshot, connectionId);
    },

    // ── Installation status ──────────────────────────────────────────────────────

    listAgentInstallationStatus: async (
      connectionId?: string,
      manager?: HostDependenciesClient
    ) => {
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      const snapshot = await snapshotFor(mgr, ensureAgentDependenciesProbed);
      return Object.values(snapshot.dependencies)
        .filter((view) => view.definition.category === 'agent')
        .map((view) => toAgentInstallationStatus(view.definition.id, connectionId, view));
    },

    getAgentInstallationStatus: async (
      id: string,
      connectionId?: string,
      manager?: HostDependenciesClient
    ) => {
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      const snapshot = await snapshotFor(mgr, ensureAgentDependenciesProbed);
      return toAgentInstallationStatus(id, connectionId, snapshot.dependencies[id]);
    },

    // ── Install / update ─────────────────────────────────────────────────────────

    update: async (_id: AgentProviderId, _connectionId?: string, _method?: unknown) => ({
      success: false as const,
      error: { type: 'no-update-command' as const, id: _id },
    }),

    install: async (
      id: AgentProviderId,
      connectionId?: string,
      method?: unknown,
      manager?: HostDependenciesClient
    ) => {
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      const result = await runRuntimeLiveJob(
        hostDependenciesContract.runInstallCommand,
        mgr.runInstallCommand,
        { id, method: normalizeInstallMethod(method) }
      );
      if (result.success) return { success: true as const, data: result.data };
      return { success: false as const, error: toAgentInstallError(result.error, id) };
    },

    uninstall: async (id: AgentProviderId, _connectionId?: string, _method?: unknown) => ({
      success: false as const,
      error: { type: 'no-uninstall-strategy' as const, id },
    }),

    // ── Settings ─────────────────────────────────────────────────────────────────

    getDefaultSettings: async (id: string): Promise<ProviderCustomConfig> => {
      const meta = await providerOverrideSettings.getItemWithMeta(id);
      return meta.defaults;
    },

    getSettings: async (id: string) => {
      return providerOverrideSettings.getItemWithMeta(id);
    },

    updateSettings: (id: string, config: Partial<ProviderCustomConfig>): Promise<void> =>
      providerOverrideSettings.updateItem(id, config),

    // ── Selection + probe ────────────────────────────────────────────────────────

    setUsedInstallation: async (
      id: DependencyId,
      connectionId?: string,
      selection?: unknown,
      manager?: HostDependenciesClient
    ): Promise<void> => {
      // undefined = no-op; null = explicit auto (clear override)
      if (selection === undefined) return;
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      await mgr.snapshot.mutate('setSelection', {
        key: undefined,
        input: { id, selection: normalizeSelection(selection) },
      });
    },

    probe: async (id: DependencyId, connectionId?: string, manager?: HostDependenciesClient) => {
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      const result = await mgr.snapshot.mutate('refresh', {
        key: undefined,
        input: { id },
      });
      return result.success ? result.data.data.dependencies[id] : result;
    },

    probeOverride: async (
      _id: DependencyId,
      _selection: { path?: string; cli?: string },
      _connectionId?: string
    ) => null,

    refreshLatestVersion: async (_id: DependencyId, _connectionId?: string): Promise<void> => {},

    probeAll: async (connectionId?: string, manager?: HostDependenciesClient) => {
      const mgr = await resolveDependencyManager(getDependencyManager, connectionId, manager);
      await ensureAgentDependenciesProbed(mgr);
    },

    listMetadata: async () => {
      return buildAgentMetadataList();
    },
  };
}

export type AgentOperations = ReturnType<typeof createAgentOperations>;

async function resolveDependencyManager(
  getDependencyManager: (
    connectionId?: string
  ) => ReturnType<Parameters<typeof createAgentOperations>[0]['getDependencyManager']>,
  connectionId?: string,
  manager?: HostDependenciesClient
): Promise<HostDependenciesClient> {
  if (manager) return manager;
  const result = await getDependencyManager(connectionId);
  if (!result.success) throw runtimeResolveErrorAsError(result.error);
  return result.data;
}

async function snapshotFor(
  manager: HostDependenciesClient,
  ensureProbed: (manager: HostDependenciesClient) => Promise<void>
): Promise<HostDependencySnapshot> {
  await ensureProbed(manager);
  const snapshot = await manager.snapshot.state(undefined, 'current').snapshot();
  return snapshot.data;
}

function normalizeSelection(selection: unknown): { kind: 'path'; path: string } | null {
  if (selection === null) return null;
  if (typeof selection !== 'object' || selection === null) return null;
  const candidate = selection as {
    kind?: unknown;
    path?: unknown;
    realpath?: unknown;
    command?: unknown;
  };
  if (candidate.kind === 'path' && typeof candidate.path === 'string') {
    return { kind: 'path', path: candidate.path };
  }
  if (candidate.kind === 'pinned' && typeof candidate.realpath === 'string') {
    return { kind: 'path', path: candidate.realpath };
  }
  if (
    candidate.kind === 'cli' &&
    typeof candidate.command === 'string' &&
    candidate.command.startsWith('/')
  ) {
    return { kind: 'path', path: candidate.command };
  }
  return null;
}

function normalizeInstallMethod(method: unknown): InstallMethod | undefined {
  return typeof method === 'string' ? (method as InstallMethod) : undefined;
}

function toAgentInstallError(error: HostDependencyError, id: AgentProviderId): AgentInstallError {
  switch (error.type) {
    case 'unknown-dependency':
    case 'no-install-command':
    case 'installer-missing':
      return error;
    case 'not-detected-after-install':
      return {
        type: 'command-failed',
        message: `Installed ${id}, but the binary was not detected on PATH.`,
        output: error.output ?? '',
      };
    case 'command-failed':
      return error;
    case 'missing':
      return {
        type: 'command-failed',
        message: `Installed ${id}, but the binary was not detected on PATH.`,
        output: '',
      };
    case 'stale-selection':
      return {
        type: 'command-failed',
        message: `Selected installation path is stale: ${error.path}`,
        output: '',
      };
    case 'invalid-selection':
      return { type: 'command-failed', message: error.message, output: '' };
    case 'no-update-command':
      return { type: 'no-install-command', id: error.id };
    case 'io':
      return { type: 'command-failed', message: error.message, output: '' };
    default:
      return { type: 'command-failed', message: `Failed to install ${id}`, output: '' };
  }
}

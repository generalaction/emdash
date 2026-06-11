import type { InstallMethod } from '@emdash/cli-agent-plugins';
import { useObserver } from 'mobx-react-lite';
import { useCallback, useMemo } from 'react';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import type {
  DependencyId,
  DependencyStatus,
  HostDependency,
  HostDependencySelection,
  Installation,
} from '@shared/core/dependencies';
import { deriveHostDependencyStatus } from '@shared/core/dependencies';
import { appState } from './app-state';
import type { DependencyOperation } from './dependencies-store';

export type HostDependencyInstallationActions = {
  /** Run the install command for the given method. */
  install(method: InstallMethod): Promise<void>;
  /** Run the update command for the given method. */
  update(method: InstallMethod): Promise<void>;
  /** Persist the user's chosen installation and trigger a re-probe. */
  setUsed(selection: HostDependencySelection): Promise<void>;
  /** Trigger a fresh probe for this dependency. */
  refresh(): Promise<void>;
  /** Fetch the latest available version from the release source. */
  fetchLatestVersion(): Promise<void>;
};

export type HostDependencyInstallation = {
  /** All resolved installations (detected method + user overrides). */
  installations: Installation[];
  /** The currently selected installation, or undefined before first probe. */
  used: Installation | undefined;
  /** Derived status from the selected installation. */
  status: DependencyStatus;
  /**
   * The current in-flight operation (install or update), if any.
   * The `method` field on the operation identifies which installation is affected.
   */
  operation: DependencyOperation | undefined;
  /** The raw HostDependency, if available. */
  hostDependency: HostDependency | undefined;
} & HostDependencyInstallationActions;

/**
 * Returns installation status and actions for a single agent dependency on a
 * specific host (local or SSH connection). Uses the HostDependency model to
 * provide per-method status, so spinners and badges can be scoped to the
 * specific method being installed/updated.
 *
 * Falls back to the AgentPayload's flat status when no HostDependency has been
 * populated yet (before the first probe completes).
 */
export function useHostDependencyInstallation(
  agentId: DependencyId,
  connectionId: string | undefined,
  agentPayload: AgentPayload | undefined
): HostDependencyInstallation {
  const { dependencies } = appState;

  const hostDependency = useObserver(() => dependencies.getHostDependency(agentId, connectionId));
  const operation = useObserver(() => dependencies.getOperation(agentId, connectionId));

  const installations = useMemo(() => {
    if (hostDependency) return hostDependency.installations;
    // Before HostDependency is populated, synthesise a single "auto" installation
    // from the flat AgentPayload status so the UI renders without waiting.
    if (!agentPayload) return [];
    return [
      {
        id: 'auto',
        source: { kind: 'cli' as const, command: agentPayload.id },
        status: agentPayload.status,
        path: agentPayload.command,
        version: agentPayload.version,
        latestVersion: agentPayload.latestVersion,
        updateAvailable: agentPayload.updateAvailable,
      } satisfies Installation,
    ];
  }, [hostDependency, agentPayload]);

  const usedId = hostDependency?.usedId ?? agentPayload?.usedId;
  const used = useMemo(() => installations.find((i) => i.id === usedId), [installations, usedId]);

  const status = useMemo((): DependencyStatus => {
    if (hostDependency) return deriveHostDependencyStatus(hostDependency);
    return agentPayload?.status ?? 'missing';
  }, [hostDependency, agentPayload]);

  const install = useCallback(
    async (method: InstallMethod) => {
      await dependencies.install(agentId, connectionId, method);
    },
    [dependencies, agentId, connectionId]
  );

  const update = useCallback(
    async (method: InstallMethod) => {
      await dependencies.update(agentId, connectionId, method);
    },
    [dependencies, agentId, connectionId]
  );

  const setUsed = useCallback(
    async (selection: HostDependencySelection) => {
      await dependencies.setUsedInstallation(agentId, connectionId, selection);
    },
    [dependencies, agentId, connectionId]
  );

  const refresh = useCallback(async () => {
    await dependencies.refreshAgents(connectionId, { refreshShellEnv: true });
  }, [dependencies, connectionId]);

  const fetchLatestVersion = useCallback(async () => {
    await dependencies.refreshLatestVersion(agentId, connectionId);
  }, [dependencies, agentId, connectionId]);

  return {
    installations,
    used,
    status,
    operation,
    hostDependency,
    install,
    update,
    setUsed,
    refresh,
    fetchLatestVersion,
  };
}

import type { AgentProviderId } from '@emdash/plugins/agents';
import { useMemo } from 'react';
import { useAgentInstallationStatuses } from '@renderer/lib/stores/use-agent-installation-statuses';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { buildAgentGroups, getAssumedInstalledAgents } from './agent-selector-options';

export function useAgentAvailability({
  connectionId,
  value,
}: {
  connectionId?: string;
  value: AgentProviderId | null;
}) {
  const { data: agents } = useAgents();
  const { data: statuses, install, isInstalling } = useAgentInstallationStatuses(connectionId);

  const dependencyData = useMemo(() => {
    if (!statuses) return null;
    const result: Record<string, { status: string; category: string }> = {};
    for (const s of statuses) {
      result[s.id] = { status: s.status, category: 'agent' };
    }
    return result;
  }, [statuses]);

  const installedAgents = useMemo(
    () =>
      dependencyData
        ? Object.entries(dependencyData)
            .filter(([, state]) => state.category === 'agent' && state.status === 'available')
            .map(([id]) => id)
        : [],
    [dependencyData]
  );

  const assumedInstalledAgents = useMemo(
    () => getAssumedInstalledAgents(value, dependencyData),
    [value, dependencyData]
  );

  const installingAgents = new Set<AgentProviderId>();

  const groups = buildAgentGroups(
    agents ?? [],
    installedAgents,
    assumedInstalledAgents,
    installingAgents
  );

  async function installAgent(agentId: AgentProviderId): Promise<void> {
    return new Promise((resolve) => {
      install({ id: agentId }, { onSettled: () => resolve() });
    });
  }

  return {
    groups,
    dependencyData,
    installingAgents,
    installAgent,
    isInstalling,
  };
}

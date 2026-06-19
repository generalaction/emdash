import { useMemo } from 'react';
import { useAgentInstallationStatuses } from '@renderer/lib/stores/use-agent-installation-statuses';
import { useAgents } from '@renderer/lib/stores/use-agents';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
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

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents ?? []) map.set(a.id, a.name);
    return map;
  }, [agents]);

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

  const getName = (id: AgentProviderId) => agentNameMap.get(id) ?? id;
  const groups = buildAgentGroups(
    installedAgents,
    assumedInstalledAgents,
    installingAgents,
    getName
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

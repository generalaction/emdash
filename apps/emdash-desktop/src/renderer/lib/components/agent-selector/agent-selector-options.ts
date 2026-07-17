import type { AgentProviderId } from '@emdash/plugins/agents';
import { agentSupportsAcp, type AgentPayload } from '@shared/core/agents/agent-payload';
import { getAgentInstallActionState } from './agent-install';

export interface AgentOption {
  value: string;
  label: string;
  agentId: AgentProviderId;
  disabled: boolean;
  supportsAcp: boolean;
}

export interface AgentGroup {
  value: string;
  label: string;
  items: AgentOption[];
}

export function buildAgentGroups(
  agents: readonly Pick<AgentPayload, 'id' | 'name' | 'capabilities'>[],
  installedAgents: string[],
  assumedInstalledAgents: string[] = [],
  installingAgents: ReadonlySet<AgentProviderId> = new Set()
): AgentGroup[] {
  const allAgentIds = agents.map((agent) => agent.id as AgentProviderId);
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const agentAcpSupport = new Map(
    agents.map((agent) => [agent.id, agentSupportsAcp(agent.capabilities)])
  );
  const installedSet = new Set(
    [...installedAgents, ...assumedInstalledAgents].filter((id) =>
      allAgentIds.includes(id as AgentProviderId)
    )
  );

  const resolveName = (id: AgentProviderId) => agentNames.get(id) ?? id;
  const supportsAcp = (id: AgentProviderId) => agentAcpSupport.get(id) ?? false;

  const installedOptions: AgentOption[] = allAgentIds
    .filter((id) => installedSet.has(id) && !installingAgents.has(id))
    .map((id) => ({
      value: id,
      label: resolveName(id),
      agentId: id,
      disabled: false,
      supportsAcp: supportsAcp(id),
    }));

  const notInstalledOptions: AgentOption[] = allAgentIds
    .filter((id) => !installedSet.has(id) || installingAgents.has(id))
    .map((id) => ({
      value: id,
      label: resolveName(id),
      agentId: id,
      disabled: true,
      supportsAcp: supportsAcp(id),
    }));

  return [
    { value: 'installed', label: 'Installed', items: installedOptions },
    { value: 'not-installed', label: 'Not installed', items: notInstalledOptions },
  ].filter((group) => group.items.length > 0);
}

export function canInstallAgentOption(item: AgentOption, allowInstall: boolean): boolean {
  return allowInstall && item.disabled;
}

export function getAssumedInstalledAgents(
  value: AgentProviderId | null,
  dependencyData: Record<string, unknown> | null
): AgentProviderId[] {
  return value && dependencyData?.[value] === undefined ? [value] : [];
}

export function isComboboxOptionDisabled(item: AgentOption): boolean {
  return item.disabled;
}

export function getInstallButtonState(
  item: AgentOption,
  allowInstall: boolean,
  installingAgents: ReadonlySet<AgentProviderId>
): { render: boolean; disabled: boolean; installing: boolean; label: string } {
  return getAgentInstallActionState({
    agentName: item.label,
    canInstall: allowInstall,
    isInstalled: !item.disabled,
    isInstalling: installingAgents.has(item.agentId),
  });
}

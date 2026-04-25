import type { AgentProviderId } from '@shared/agent-provider-registry';
import { agentConfig } from '@renderer/utils/agentConfig';
import { getAgentInstallActionState } from './agent-install';

export interface AgentOption {
  value: string;
  label: string;
  agentId: AgentProviderId;
  disabled: boolean;
}

export interface AgentGroup {
  value: string;
  label: string;
  items: AgentOption[];
}

export function buildAgentGroups(
  installedAgents: string[],
  assumedInstalledAgents: string[] = []
): AgentGroup[] {
  const installedSet = new Set(
    [...installedAgents, ...assumedInstalledAgents].filter((id) => id in agentConfig)
  );
  const allAgentIds = Object.keys(agentConfig) as AgentProviderId[];

  const installedOptions: AgentOption[] = allAgentIds
    .filter((id) => installedSet.has(id))
    .map((id) => ({ value: id, label: agentConfig[id].name, agentId: id, disabled: false }));

  const notInstalledOptions: AgentOption[] = allAgentIds
    .filter((id) => !installedSet.has(id))
    .map((id) => ({ value: id, label: agentConfig[id].name, agentId: id, disabled: true }));

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
    agentId: item.agentId,
    canInstall: allowInstall,
    isInstalled: !item.disabled,
    isInstalling: installingAgents.has(item.agentId),
  });
}

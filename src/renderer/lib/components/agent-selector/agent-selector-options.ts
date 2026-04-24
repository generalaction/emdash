import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { DependencyInstallError } from '@shared/dependencies';
import { agentConfig } from '@renderer/utils/agentConfig';

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

export function getAgentInstallErrorMessage(error: DependencyInstallError): string {
  switch (error.type) {
    case 'permission-denied':
      return error.message;
    case 'command-failed':
      return error.output ? `${error.message} ${error.output}` : error.message;
    case 'pty-open-failed':
      return error.message;
    case 'unknown-dependency':
      return `Unknown dependency: ${error.id}`;
    case 'no-install-command':
      return `No install command is available for ${error.id}.`;
    case 'not-detected-after-install':
      return 'The agent was not detected after installation.';
  }
}

export function getInstallButtonState(
  item: AgentOption,
  allowInstall: boolean,
  installingAgents: ReadonlySet<AgentProviderId>
): { render: boolean; disabled: boolean; installing: boolean; label: string } {
  const installing = installingAgents.has(item.agentId);
  return {
    render: canInstallAgentOption(item, allowInstall),
    disabled: installing,
    installing,
    label: `Install ${agentConfig[item.agentId].name}`,
  };
}

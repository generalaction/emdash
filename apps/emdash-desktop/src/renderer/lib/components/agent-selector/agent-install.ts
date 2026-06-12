import type { DependencyInstallError, DependencyUpdateError } from '@emdash/shared/deps/runtime';
import { getProvider, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';

export type AgentInstallActionState = {
  render: boolean;
  disabled: boolean;
  installing: boolean;
  label: string;
};

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

export function getAgentInstallActionState({
  agentId,
  agentName,
  canInstall,
  isInstalled,
  isInstalling,
}: {
  agentId: AgentProviderId;
  agentName?: string;
  canInstall: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
}): AgentInstallActionState {
  return {
    render: canInstall && !isInstalled,
    disabled: isInstalling,
    installing: isInstalling,
    label: `Install ${agentName ?? getProvider(agentId)?.name ?? agentId}`,
  };
}

export type AgentUpdateActionState = {
  render: boolean;
  disabled: boolean;
  updating: boolean;
  label: string;
  versionLabel: string | null;
};

export function getAgentUpdateErrorMessage(error: DependencyUpdateError): string {
  switch (error.type) {
    case 'permission-denied':
      return error.message;
    case 'command-failed':
      return error.output ? `${error.message} ${error.output}` : error.message;
    case 'pty-open-failed':
      return error.message;
    case 'unknown-dependency':
      return `Unknown dependency: ${error.id}`;
    case 'no-update-strategy':
      return `No update strategy is available for ${error.id}.`;
    case 'not-detected-after-update':
      return 'The agent was not detected after update.';
  }
}

export function getAgentUpdateActionState({
  updateAvailable,
  updateStrategyKind,
  version,
  latestVersion,
  isUpdating,
}: {
  updateAvailable: boolean;
  updateStrategyKind: string;
  version: string | null;
  latestVersion: string | null;
  isUpdating: boolean;
}): AgentUpdateActionState {
  const canUpdate =
    updateAvailable && updateStrategyKind !== 'auto' && updateStrategyKind !== 'none';
  const versionLabel = version && latestVersion ? `v${version} → v${latestVersion}` : null;

  return {
    render: canUpdate,
    disabled: isUpdating,
    updating: isUpdating,
    label: isUpdating ? 'Updating...' : 'Update',
    versionLabel,
  };
}

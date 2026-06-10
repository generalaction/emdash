import { metadataRegistry } from 'cli-agent-plugins/metadata';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { DependencyInstallError } from '@shared/core/dependencies';

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
  canInstall,
  isInstalled,
  isInstalling,
}: {
  agentId: AgentProviderId;
  canInstall: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
}): AgentInstallActionState {
  return {
    render: canInstall && !isInstalled,
    disabled: isInstalling,
    installing: isInstalling,
    label: `Install ${metadataRegistry.get(agentId)?.name ?? agentId}`,
  };
}

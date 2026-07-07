import { match } from 'ts-pattern';
import type { AgentInstallError, AgentUpdateError } from '@shared/core/agents/agent-payload';
import { getProvider, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';

export type AgentInstallActionState = {
  render: boolean;
  disabled: boolean;
  installing: boolean;
  label: string;
};

export function getAgentInstallErrorMessage(error: AgentInstallError): string {
  return match(error)
    .with({ type: 'permission-denied' }, (e) => e.message)
    .with({ type: 'command-failed' }, (e) => (e.output ? `${e.message} ${e.output}` : e.message))
    .with({ type: 'pty-open-failed' }, (e) => e.message)
    .with({ type: 'unknown-dependency' }, (e) => `Unknown dependency: ${e.id}`)
    .with({ type: 'no-install-command' }, (e) => `No install command is available for ${e.id}.`)
    .with(
      { type: 'not-detected-after-install' },
      () => 'The agent was not detected after installation.'
    )
    .exhaustive();
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

export function getAgentUpdateErrorMessage(error: AgentUpdateError): string {
  return match(error)
    .with({ type: 'permission-denied' }, (e) => e.message)
    .with({ type: 'command-failed' }, (e) => (e.output ? `${e.message} ${e.output}` : e.message))
    .with({ type: 'pty-open-failed' }, (e) => e.message)
    .with({ type: 'unknown-dependency' }, (e) => `Unknown dependency: ${e.id}`)
    .with({ type: 'no-update-strategy' }, (e) => `No update strategy is available for ${e.id}.`)
    .with({ type: 'not-detected-after-update' }, () => 'The agent was not detected after update.')
    .exhaustive();
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

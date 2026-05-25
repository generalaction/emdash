import { agentConfig } from '@renderer/utils/agentConfig';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Automation, AutomationRun } from '@shared/automations/types';

export type AutomationTool = {
  id: string;
  label: string;
  logo: string;
  isSvg?: boolean;
  invertInDark?: boolean;
};

function toolForProvider(provider: AgentProviderId | null | undefined): AutomationTool | null {
  const cfg = provider ? agentConfig[provider] : undefined;
  if (!cfg) return null;
  return {
    id: `agent:${provider}`,
    label: cfg.name,
    logo: cfg.logo,
    isSvg: cfg.isSvg,
    invertInDark: cfg.invertInDark,
  };
}

export function automationTool(automation: Automation | undefined): AutomationTool | null {
  const provider = automation?.taskConfig?.initialConversation?.provider;
  return toolForProvider(provider);
}

export function automationRunTool(
  run: AutomationRun,
  automation: Automation | undefined
): AutomationTool | null {
  const provider =
    run.agentProviderId === undefined
      ? automation?.taskConfig?.initialConversation?.provider
      : run.agentProviderId;
  return toolForProvider(provider);
}

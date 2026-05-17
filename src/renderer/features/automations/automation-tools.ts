import type { Automation } from '@shared/automations/types';
import { agentConfig } from '@renderer/utils/agentConfig';

export type AutomationTool = {
  id: string;
  label: string;
  logo: string;
  isSvg?: boolean;
  invertInDark?: boolean;
};

export function automationTool(automation: Automation | undefined): AutomationTool | null {
  const provider = automation?.taskConfig?.initialConversation?.provider;
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

import type { ActionSpec } from '@shared/automations/actions';
import type { Automation } from '@shared/automations/types';
import { agentConfig } from '@renderer/utils/agentConfig';

export type AutomationTool = {
  id: string;
  label: string;
  logo: string;
  isSvg?: boolean;
  invertInDark?: boolean;
};

export function actionTool(action: ActionSpec): AutomationTool | null {
  const cfg = action.provider ? agentConfig[action.provider] : undefined;
  if (!cfg) return null;
  return {
    id: `agent:${action.provider}`,
    label: cfg.name,
    logo: cfg.logo,
    isSvg: cfg.isSvg,
    invertInDark: cfg.invertInDark,
  };
}

export function collectTools(automation: Automation): AutomationTool[] {
  const seen = new Set<string>();
  const tools: AutomationTool[] = [];
  for (const action of automation.actions) {
    const tool = actionTool(action);
    if (!tool || seen.has(tool.id)) continue;
    seen.add(tool.id);
    tools.push(tool);
  }
  return tools;
}

export function getPrimaryTool(automation: Automation | undefined): AutomationTool | null {
  if (!automation) return null;
  for (const action of automation.actions) {
    const tool = actionTool(action);
    if (tool) return tool;
  }
  return null;
}

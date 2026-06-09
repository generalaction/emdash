import { useAutomation, useAutomations } from './use-automations';

export function useAutomationRunActions(automationId: string) {
  const { stop } = useAutomations();
  const automation = useAutomation(automationId);
  return {
    stopRun: stop.mutate,
    projectId: automation?.projectId ?? null,
  };
}

import type { AutomationRun } from '@shared/automations/automation-run';

export function useAutomationRunActions() {
  return {
    deleteRun: undefined as ((run: AutomationRun) => void) | undefined,
    bulkDeleteRuns: undefined as
      | ((runIds: ReadonlyArray<string>, onDone?: () => void) => void)
      | undefined,
    rerunFrom: undefined as ((automationId: string) => void) | undefined,
  };
}

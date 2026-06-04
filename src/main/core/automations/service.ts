import type { Automation } from '@shared/automations/types';
import {
  detachProjectAutomations,
  setAutomationEnabled as setAutomationEnabledInRepo,
  skipQueuedCronRuns,
} from './repo';
import { emitRunTransition } from './run-transitions';

export async function setAutomationEnabled(
  id: string,
  enabled: boolean
): Promise<Automation | null> {
  const automation = await setAutomationEnabledInRepo(id, enabled);
  if (automation && !enabled) {
    const skippedRuns = await skipQueuedCronRuns(id, 'automation_disabled');
    skippedRuns.forEach((run) => emitRunTransition(run));
  }
  return automation;
}

export async function detachProject(projectId: string): Promise<number> {
  const automations = await detachProjectAutomations(projectId);
  const skippedRuns = await Promise.all(
    automations.map((automation) => skipQueuedCronRuns(automation.id, 'no_project_attached'))
  );
  skippedRuns.flat().forEach((run) => emitRunTransition(run));
  return automations.length;
}

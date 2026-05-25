import type { Automation } from '@shared/automations/types';
import {
  detachProjectAutomations,
  setAutomationEnabled as setAutomationEnabledInRepo,
  skipQueuedCronRuns,
} from './repo';
import { emitRunUpdated } from './runtime';

export async function setAutomationEnabled(
  id: string,
  enabled: boolean
): Promise<Automation | null> {
  const automation = await setAutomationEnabledInRepo(id, enabled);
  if (automation && !enabled) {
    const skippedRuns = await skipQueuedCronRuns(id, 'automation_disabled');
    skippedRuns.forEach((run) => emitRunUpdated(run));
  }
  return automation;
}

export async function detachProject(projectId: string): Promise<number> {
  const automations = await detachProjectAutomations(projectId);
  const skippedRuns = await Promise.all(
    automations.map((automation) => skipQueuedCronRuns(automation.id, 'no_project_attached'))
  );
  skippedRuns.flat().forEach((run) => emitRunUpdated(run));
  return automations.length;
}

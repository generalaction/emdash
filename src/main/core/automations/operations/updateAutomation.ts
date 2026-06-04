import type { UpdateAutomationPatch } from '@shared/automations/automation';
import { ensureNextCronRun, skipQueuedCronRuns, updateAutomation as updateInRepo } from '../repo';

export async function updateAutomation(id: string, patch: UpdateAutomationPatch) {
  const automation = await updateInRepo(id, patch);
  if (!automation) throw new Error('automation_not_found');
  if (patch.triggerConfig !== undefined) {
    await skipQueuedCronRuns(id, 'trigger_changed');
    if (automation.enabled) await ensureNextCronRun(automation);
  }
  return automation;
}

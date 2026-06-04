import { events } from '@main/lib/events';
import { automationsChangedChannel } from '@shared/events/automationEvents';
import { enqueueAutomationRun, getAutomation } from '../repo';

export async function runAutomation(id: string) {
  const automation = await getAutomation(id);
  if (!automation) throw new Error('automation_not_found');
  if (!automation.projectId) throw new Error('no_project_attached');
  if (!automation.conversationConfig || !automation.triggerConfig)
    throw new Error('automation_not_configured');
  const run = await enqueueAutomationRun({
    automationId: id,
    triggerConfigSnapshot: automation.triggerConfig,
    conversationConfigSnapshot: automation.conversationConfig,
    taskConfigSnapshot: automation.taskConfig ?? null,
    scheduledAt: Date.now(),
    deadlineAt: null,
    triggerKind: 'manual',
  });
  if (!run) throw new Error('run_already_queued');
  events.emit(automationsChangedChannel, undefined);
  return run;
}

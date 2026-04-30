import type { AutomationEvent } from '@shared/automations/events';
import type {
  Automation,
  AutomationRun,
  AutomationRunTriggerKind,
} from '@shared/automations/types';
import { automationRunUpdatedChannel } from '@shared/events/automationEvents';
import { err, ok, type Result } from '@shared/result';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { executeAction } from './actions';
import { countRunningRuns, insertRun, updateAutomationSchedule, updateRun } from './repo';

export function emitRunUpdated(run: AutomationRun, sessionId?: string): void {
  events.emit(automationRunUpdatedChannel, {
    automationId: run.automationId,
    runId: run.id,
    status: run.status,
    taskId: run.taskId,
    sessionId,
  });
}

export async function runAutomation(
  automation: Automation,
  triggerKind: AutomationRunTriggerKind,
  event: AutomationEvent | null = null
): Promise<Result<AutomationRun, string>> {
  const runningCount = await countRunningRuns(automation.id);
  if (triggerKind === 'cron' && runningCount > 0) {
    const skipped = await insertRun({
      automationId: automation.id,
      status: 'skipped',
      triggerKind,
      finishedAt: Date.now(),
      error: 'previous_still_running',
    });
    emitRunUpdated(skipped);
    return ok(skipped);
  }
  if (automation.actions.length === 0) {
    const failed = await insertRun({
      automationId: automation.id,
      status: 'failed',
      triggerKind,
      finishedAt: Date.now(),
      error: 'no_actions_configured',
    });
    emitRunUpdated(failed);
    return err('no_actions_configured');
  }

  let run = await insertRun({
    automationId: automation.id,
    status: 'running',
    triggerKind,
  });
  emitRunUpdated(run);

  let firstTaskId: string | null = null;
  let firstSessionId: string | undefined;
  const ctx = { automation, event };

  for (let i = 0; i < automation.actions.length; i++) {
    const action = automation.actions[i];
    const result = await executeAction(action, ctx);
    if (!result.success) {
      const message = `action_${i}_${action.kind}:${result.error}`;
      log.error('Automation action failed', {
        automationId: automation.id,
        runId: run.id,
        actionIndex: i,
        actionKind: action.kind,
        error: result.error,
      });
      run =
        (await updateRun(run.id, {
          status: 'failed',
          finishedAt: Date.now(),
          taskId: firstTaskId,
          error: message,
        })) ?? run;
      emitRunUpdated(run);
      return err(message);
    }
    if (firstTaskId == null && result.data.taskId) {
      firstTaskId = result.data.taskId;
      firstSessionId = result.data.sessionId;
    }
  }

  run =
    (await updateRun(run.id, {
      status: 'success',
      finishedAt: Date.now(),
      taskId: firstTaskId,
    })) ?? run;
  await updateAutomationSchedule(automation.id, { lastRunAt: run.startedAt });
  emitRunUpdated(run, firstSessionId);
  return ok(run);
}

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
import { automationRunEvents } from './automation-run-events';
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
  triggerKind: AutomationRunTriggerKind
): Promise<Result<AutomationRun, string>> {
  if (triggerKind === 'cron' && (await countRunningRuns(automation.id)) > 0) {
    const skipped = await insertRun({
      automationId: automation.id,
      status: 'skipped',
      triggerKind,
      finishedAt: Date.now(),
      error: 'previous_still_running',
    });
    emitRunUpdated(skipped);
    automationRunEvents._emit('run:skipped', skipped, automation, 'previous_still_running');
    return ok(skipped);
  }
  if (automation.actions.length === 0) {
    const failed = await insertRun({
      automationId: automation.id,
      status: 'running',
      triggerKind,
    });
    return failRun(failed, automation, 'no_actions_configured');
  }

  const run = await insertRun({
    automationId: automation.id,
    status: 'running',
    triggerKind,
  });
  emitRunUpdated(run);
  automationRunEvents._emit('run:started', run, automation);

  return executeAutomationRun(automation, run);
}

export async function runQueuedAutomation(
  automation: Automation,
  run: AutomationRun
): Promise<Result<AutomationRun, string>> {
  emitRunUpdated(run);
  automationRunEvents._emit('run:started', run, automation);
  return executeAutomationRun(automation, run);
}

async function executeAutomationRun(
  automation: Automation,
  initialRun: AutomationRun
): Promise<Result<AutomationRun, string>> {
  let run = initialRun;
  if (automation.actions.length === 0) {
    return failRun(run, automation, 'no_actions_configured');
  }

  let firstTaskId: string | null = null;
  let firstSessionId: string | undefined;
  const ctx = { automation };

  for (let i = 0; i < automation.actions.length; i++) {
    const action = automation.actions[i];
    const result = await executeAction(action, ctx).catch((error) => ({
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
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
          createdTaskId: firstTaskId,
          error: message,
        })) ?? run;
      emitRunUpdated(run);
      automationRunEvents._emit('run:failed', run, automation, message);
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
      createdTaskId: firstTaskId,
    })) ?? run;
  await updateAutomationSchedule(automation.id, { lastRunAt: run.startedAt });
  emitRunUpdated(run, firstSessionId);
  automationRunEvents._emit('run:succeeded', run, automation);
  return ok(run);
}

async function failRun(
  run: AutomationRun,
  automation: Automation,
  error: string
): Promise<Result<AutomationRun, string>> {
  const failed =
    (await updateRun(run.id, {
      status: 'failed',
      finishedAt: Date.now(),
      error,
    })) ?? run;
  emitRunUpdated(failed);
  automationRunEvents._emit('run:failed', failed, automation, error);
  return err(error);
}

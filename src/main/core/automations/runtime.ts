import type { Automation, AutomationRun } from '@shared/automations/types';
import { automationRunUpdatedChannel } from '@shared/events/automationEvents';
import { err, ok, type Result } from '@shared/result';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { executeTaskCreate } from './actions/taskCreate';
import type { ActionError, ActionOutcome } from './actions/types';
import { updateAutomationSchedule, updateRun } from './repo';

export function emitRunUpdated(run: AutomationRun, sessionId?: string): void {
  events.emit(automationRunUpdatedChannel, {
    automationId: run.automationId,
    runId: run.id,
    status: run.status,
    taskId: run.taskId,
    sessionId,
  });
}

export async function runQueuedAutomation(
  automation: Automation,
  initialRun: AutomationRun
): Promise<Result<AutomationRun, string>> {
  emitRunUpdated(initialRun);

  let run = initialRun;
  let firstTaskId: string | null = null;
  let firstSessionId: string | undefined;
  const ctx = { automation };

  if (automation.actions.length === 0) {
    const message = 'no_actions_configured';
    log.error('Automation has no actions', {
      automationId: automation.id,
      runId: run.id,
    });
    run =
      (await updateRun(run.id, {
        status: 'failed',
        finishedAt: Date.now(),
        error: message,
      })) ?? run;
    emitRunUpdated(run);
    return err(message);
  }

  for (let i = 0; i < automation.actions.length; i++) {
    const action = automation.actions[i];
    const result = await executeTaskCreate(action, ctx).catch(
      (error): Result<ActionOutcome, ActionError> => ({
        success: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    );
    if (!result.success) {
      const failedTaskId = firstTaskId ?? result.error.taskId ?? null;
      const message = result.error.message;
      log.error('Automation action failed', {
        automationId: automation.id,
        runId: run.id,
        actionIndex: i,
        error: message,
      });
      run =
        (await updateRun(run.id, {
          status: 'failed',
          finishedAt: Date.now(),
          taskId: failedTaskId,
          createdTaskId: failedTaskId,
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
      createdTaskId: firstTaskId,
    })) ?? run;
  await updateAutomationSchedule(automation.id, { lastRunAt: run.startedAt ?? Date.now() });
  emitRunUpdated(run, firstSessionId);
  return ok(run);
}

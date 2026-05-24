import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { automationRunUpdatedChannel } from '@shared/events/automationEvents';
import { err, ok, type Result } from '@shared/result';
import { executeTaskCreate } from './actions/taskCreate';
import type { ActionError, ActionOutcome } from './actions/types';
import { automationEvents } from './automation-events';
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
  const ctx = { automation, run };

  if (automation.projectId == null) {
    const message = 'no_project_attached';
    const finishedAt = Date.now();
    run = (await updateRun(run.id, {
      status: 'skipped',
      finishedAt,
      error: message,
    })) ?? { ...run, status: 'skipped', finishedAt, error: message };
    emitRunUpdated(run);
    automationEvents._emit('automation:run:skipped', run);
    return err(message);
  }

  if (automation.actions.length === 0) {
    const message = 'no_actions_configured';
    log.error('Automation has no actions', {
      automationId: automation.id,
      runId: run.id,
    });
    const finishedAt = Date.now();
    run = (await updateRun(run.id, {
      status: 'failed',
      finishedAt,
      error: message,
    })) ?? { ...run, status: 'failed', finishedAt, error: message };
    emitRunUpdated(run);
    automationEvents._emit('automation:run:failed', run);
    return err(message);
  }

  for (let i = 0; i < automation.actions.length; i++) {
    const action = automation.actions[i];
    const result = await executeTaskCreate(action, { ...ctx, run }).catch(
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
      const finishedAt = Date.now();
      run = (await updateRun(run.id, {
        status: 'failed',
        finishedAt,
        taskId: failedTaskId,
        createdTaskId: failedTaskId,
        error: message,
      })) ?? {
        ...run,
        status: 'failed',
        finishedAt,
        taskId: failedTaskId,
        createdTaskId: failedTaskId,
        error: message,
      };
      emitRunUpdated(run);
      automationEvents._emit('automation:run:failed', run);
      return err(message);
    }
    if (firstTaskId == null && result.data.taskId) {
      firstTaskId = result.data.taskId;
      firstSessionId = result.data.sessionId;
      run = { ...run, taskId: firstTaskId, createdTaskId: firstTaskId };
    }
  }

  const finishedAt = Date.now();
  run = (await updateRun(run.id, {
    status: 'success',
    finishedAt,
    taskId: firstTaskId,
    createdTaskId: firstTaskId,
  })) ?? {
    ...run,
    status: 'success',
    finishedAt,
    taskId: firstTaskId,
    createdTaskId: firstTaskId,
  };
  await updateAutomationSchedule(automation.id, { lastRunAt: run.startedAt ?? Date.now() });
  emitRunUpdated(run, firstSessionId);
  automationEvents._emit('automation:run:finish', run);
  return ok(run);
}

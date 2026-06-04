import { log } from '@main/lib/logger';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { err, ok, type Result } from '@shared/result';
import { executeTaskCreate } from './actions/taskCreate';
import type { ActionError, ActionOutcome } from './actions/types';
import { markRunFailed, markRunSkipped, markRunSucceeded } from './run-transitions';

export async function runQueuedAutomation(
  automation: Automation,
  initialRun: AutomationRun
): Promise<Result<AutomationRun, string>> {
  let run = initialRun;
  let firstTaskId: string | null = null;
  let latestTaskId: string | null = null;
  const ctx = { automation, run };

  if (automation.projectId == null) {
    const message = 'no_project_attached';
    const finishedAt = Date.now();
    run = await markRunSkipped(run.id, message, { finishedAt });
    return err(message);
  }

  if (automation.actions.length === 0) {
    const message = 'no_actions_configured';
    log.warn('Automation has no actions', {
      automationId: automation.id,
      runId: run.id,
    });
    const finishedAt = Date.now();
    run = await markRunSkipped(run.id, message, { finishedAt });
    return ok(run);
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
      const failedTaskId = result.error.taskId ?? latestTaskId ?? firstTaskId ?? null;
      const createdTaskId = firstTaskId ?? result.error.taskId ?? null;
      const message = result.error.message;
      log.error('Automation action failed', {
        automationId: automation.id,
        runId: run.id,
        actionIndex: i,
        error: message,
      });
      const finishedAt = Date.now();
      run = await markRunFailed(run.id, {
        error: message,
        finishedAt,
        taskId: failedTaskId,
        createdTaskId,
      });
      return err(message);
    }
    if (firstTaskId == null && result.data.taskId) {
      firstTaskId = result.data.taskId;
      run = { ...run, taskId: firstTaskId, createdTaskId: firstTaskId };
    }
    latestTaskId = result.data.taskId ?? latestTaskId;
  }

  const finishedAt = Date.now();
  run = await markRunSucceeded(run.id, {
    finishedAt,
    taskId: latestTaskId,
    createdTaskId: firstTaskId,
  });
  return ok(run);
}

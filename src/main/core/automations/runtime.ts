import { log } from '@main/lib/logger';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import { err, ok, type Result } from '@shared/result';
import { executeTaskCreate } from './actions/taskCreate';
import type { ActionError, ActionOutcome } from './actions/types';
import { markRunFailed, markRunSkipped, markRunSucceeded } from './run-transitions';

export async function runQueuedAutomation(
  automation: Automation,
  initialRun: AutomationRun
): Promise<Result<AutomationRun, string>> {
  let run = initialRun;

  if (automation.projectId == null) {
    const message = 'no_project_attached';
    run = await markRunSkipped(run.id, message, { finishedAt: Date.now() });
    return err(message);
  }

  const prompt = run.conversationConfigSnapshot.prompt?.trim();
  if (!prompt) {
    const message = 'no_actions_configured';
    log.warn('Automation run has no prompt in conversationConfigSnapshot', {
      automationId: automation.id,
      runId: run.id,
    });
    run = await markRunSkipped(run.id, message, { finishedAt: Date.now() });
    return ok(run);
  }

  const result = await executeTaskCreate({ automation, run }).catch(
    (error): Result<ActionOutcome, ActionError> => ({
      success: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    })
  );

  if (!result.success) {
    const message = result.error.message;
    log.error('Automation task create failed', {
      automationId: automation.id,
      runId: run.id,
      error: message,
    });
    run = await markRunFailed(run.id, {
      error: message,
      finishedAt: Date.now(),
      taskId: result.error.taskId ?? null,
    });
    return err(message);
  }

  run = await markRunSucceeded(run.id, {
    finishedAt: Date.now(),
    taskId: result.data.taskId ?? null,
  });
  return ok(run);
}

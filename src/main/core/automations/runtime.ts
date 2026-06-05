import { log } from '@main/lib/logger';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import { err, ok, type Result } from '@shared/result';
import { executeTaskCreate } from './actions/taskCreate';
import { markRunDone, markRunSkipped, type OnStepCompleted } from './run-transitions';

export type { OnStepCompleted };

export type AutomationRunExecutor = (
  automation: Automation,
  run: AutomationRun,
  onStepCompleted: OnStepCompleted
) => Promise<Result<AutomationRun, string>>;

export async function runQueuedAutomation(
  automation: Automation,
  initialRun: AutomationRun,
  onStepCompleted: OnStepCompleted
): Promise<Result<AutomationRun, string>> {
  let run = initialRun;

  if (automation.projectId == null) {
    run = await markRunSkipped(run.id, { step: 'queue', code: 'no_project' });
    onStepCompleted(run);
    return err('no_project');
  }

  const prompt = automation.conversationConfig?.prompt?.trim();
  if (!prompt) {
    log.warn('Automation run has no prompt in conversationConfigSnapshot', {
      automationId: automation.id,
      runId: run.id,
    });
    run = await markRunSkipped(run.id, { step: 'queue', code: 'no_actions_configured' });
    onStepCompleted(run);
    return ok(run);
  }

  const result = await executeTaskCreate(automation, run, onStepCompleted).catch(
    (error): Result<string, string> => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  );

  if (!result.success) {
    log.error('Automation task create failed', {
      automationId: automation.id,
      runId: run.id,
      error: result.error,
    });
    // markRunFailed was already called inside executeTaskCreate
    return err(result.error);
  }

  run = await markRunDone(run.id, Date.now());
  onStepCompleted(run);
  return ok(run);
}

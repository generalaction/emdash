import { log } from '@main/lib/logger';
import type { AutomationRun, RunError } from '@shared/automations/automation-run';
import { updateRun } from './repo';

export type OnStepCompleted = (run: AutomationRun) => void;

type RunUpdateValues = Parameters<typeof updateRun>[1];

export async function updateRunOrThrow(
  runId: string,
  values: RunUpdateValues
): Promise<AutomationRun> {
  const run = await updateRun(runId, values);
  if (!run) {
    log.error('Automation run update failed', { runId, values });
    throw new Error('run_update_failed');
  }
  return run;
}

/** scheduled → queued */
export async function markRunQueued(runId: string): Promise<AutomationRun> {
  return updateRunOrThrow(runId, { status: 'queued' });
}

/** queued → creating_task, writes startedAt */
export async function markRunCreatingTask(runId: string, now: number): Promise<AutomationRun> {
  return updateRunOrThrow(runId, { status: 'creating_task', startedAt: now });
}

/** creating_task → launching_task, writes taskId + taskCreatedAt */
export async function markRunLaunchingTask(
  runId: string,
  taskId: string,
  now: number
): Promise<AutomationRun> {
  return updateRunOrThrow(runId, { status: 'launching_task', taskId, taskCreatedAt: now });
}

/** launching_task → creating_conversation, writes launchedAt */
export async function markRunCreatingConversation(
  runId: string,
  now: number
): Promise<AutomationRun> {
  return updateRunOrThrow(runId, { status: 'creating_conversation', launchedAt: now });
}

/** creating_conversation → done, writes finishedAt */
export async function markRunDone(runId: string, finishedAt: number): Promise<AutomationRun> {
  return updateRunOrThrow(runId, { status: 'done', finishedAt });
}

/** any step → failed, writes JSON error + finishedAt */
export async function markRunFailed(
  runId: string,
  error: RunError,
  finishedAt?: number
): Promise<AutomationRun> {
  return updateRunOrThrow(runId, {
    status: 'failed',
    error: JSON.stringify(error),
    finishedAt: finishedAt ?? Date.now(),
  });
}

/** queued → skipped, writes JSON error + finishedAt */
export async function markRunSkipped(runId: string, error: RunError): Promise<AutomationRun> {
  return updateRunOrThrow(runId, {
    status: 'skipped',
    error: JSON.stringify(error),
    finishedAt: Date.now(),
  });
}

import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { AutomationRun, RunError } from '@shared/automations/automation-run';
import {
  automationsChangedChannel,
  automationRunUpdatedChannel,
} from '@shared/events/automationEvents';
import { updateRun } from './repo';

type RunUpdateValues = Parameters<typeof updateRun>[1];

function emitRunUpdatedEvent(run: AutomationRun, emitChanged = false): void {
  events.emit(automationRunUpdatedChannel, {
    automationId: run.automationId,
    runId: run.id,
    status: run.status,
    taskId: run.taskId,
    startedAt: run.startedAt,
  });
  if (emitChanged) {
    events.emit(automationsChangedChannel, undefined);
  }
}

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

async function updateRunAndEmit(
  runId: string,
  values: RunUpdateValues,
  emitChanged = false
): Promise<AutomationRun> {
  const run = await updateRunOrThrow(runId, values);
  emitRunUpdatedEvent(run, emitChanged);
  return run;
}

export function emitRunUpdated(run: AutomationRun): void {
  emitRunUpdatedEvent(run);
}

/** scheduled → queued */
export async function markRunQueued(runId: string): Promise<AutomationRun> {
  return updateRunAndEmit(runId, { status: 'queued' }, false);
}

/** queued → creating_task, writes startedAt */
export async function markRunCreatingTask(runId: string, now: number): Promise<AutomationRun> {
  return updateRunAndEmit(runId, { status: 'creating_task', startedAt: now }, true);
}

/** creating_task → launching_task, writes taskId + taskCreatedAt */
export async function markRunLaunchingTask(
  runId: string,
  taskId: string,
  now: number
): Promise<AutomationRun> {
  return updateRunAndEmit(runId, { status: 'launching_task', taskId, taskCreatedAt: now });
}

/** launching_task → creating_conversation, writes launchedAt */
export async function markRunCreatingConversation(
  runId: string,
  now: number
): Promise<AutomationRun> {
  return updateRunAndEmit(runId, { status: 'creating_conversation', launchedAt: now });
}

/** creating_conversation → done, writes finishedAt */
export async function markRunDone(runId: string, finishedAt: number): Promise<AutomationRun> {
  return updateRunAndEmit(runId, { status: 'done', finishedAt }, true);
}

/** any step → failed, writes JSON error + finishedAt */
export async function markRunFailed(
  runId: string,
  error: RunError,
  finishedAt?: number
): Promise<AutomationRun> {
  return updateRunAndEmit(
    runId,
    {
      status: 'failed',
      error: JSON.stringify(error),
      finishedAt: finishedAt ?? Date.now(),
    },
    true
  );
}

/** queued → skipped, writes JSON error + finishedAt */
export async function markRunSkipped(runId: string, error: RunError): Promise<AutomationRun> {
  return updateRunAndEmit(
    runId,
    {
      status: 'skipped',
      error: JSON.stringify(error),
      finishedAt: Date.now(),
    },
    true
  );
}

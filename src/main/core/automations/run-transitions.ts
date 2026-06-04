import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { AutomationRun } from '@shared/automations/automation-run';
import {
  automationsChangedChannel,
  automationRunUpdatedChannel,
} from '@shared/events/automationEvents';
import { updateRun } from './repo';

type RunHookName =
  | 'automation:run:start'
  | 'automation:run:finish'
  | 'automation:run:failed'
  | 'automation:run:skipped';

type RunUpdateValues = Parameters<typeof updateRun>[1];

interface EmitRunTransitionOptions {
  hook?: RunHookName | false;
  emitUpdate?: boolean;
}

function emitRunTransition(run: AutomationRun, options?: EmitRunTransitionOptions): void {
  if (options?.emitUpdate !== false) {
    events.emit(automationRunUpdatedChannel, {
      automationId: run.automationId,
      runId: run.id,
      status: run.status,
      taskId: run.taskId,
      startedAt: run.startedAt,
    });
  }
  if (options?.hook) {
    events.emit(automationsChangedChannel, undefined);
  }
}

export function emitRunUpdated(run: AutomationRun): void {
  emitRunTransition(run, { hook: false });
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

export async function updateRunAndEmit(
  runId: string,
  values: RunUpdateValues,
  options?: EmitRunTransitionOptions
): Promise<AutomationRun> {
  const run = await updateRunOrThrow(runId, values);
  emitRunTransition(run, options);
  return run;
}

export function emitQueuedRun(run: AutomationRun): void {
  emitRunTransition(run, { hook: false });
}

export function emitClaimedRunStarted(run: AutomationRun): void {
  emitRunTransition(run, { hook: 'automation:run:start' });
}

export async function linkRunTask(runId: string, taskId: string): Promise<AutomationRun> {
  return updateRunAndEmit(runId, { taskId }, { hook: false });
}

export async function markRunSkipped(
  runId: string,
  reason: string,
  options: { finishedAt?: number; workerId?: string | null } = {}
): Promise<AutomationRun> {
  const values: RunUpdateValues = {
    status: 'skipped',
    finishedAt: options.finishedAt ?? Date.now(),
    error: reason,
  };
  if ('workerId' in options) values.workerId = options.workerId;
  return updateRunAndEmit(runId, values, { hook: 'automation:run:skipped' });
}

export async function markRunFailed(
  runId: string,
  input: {
    error: string;
    finishedAt?: number;
    taskId?: string | null;
  }
): Promise<AutomationRun> {
  const values: RunUpdateValues = {
    status: 'failed',
    finishedAt: input.finishedAt ?? Date.now(),
    error: input.error,
  };
  if ('taskId' in input) values.taskId = input.taskId;
  return updateRunAndEmit(runId, values, { hook: 'automation:run:failed' });
}

export async function markRunSucceeded(
  runId: string,
  input: {
    finishedAt?: number;
    taskId: string | null;
  }
): Promise<AutomationRun> {
  return updateRunAndEmit(
    runId,
    {
      status: 'success',
      finishedAt: input.finishedAt ?? Date.now(),
      taskId: input.taskId,
    },
    { hook: 'automation:run:finish' }
  );
}

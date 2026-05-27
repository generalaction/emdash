import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { AutomationRun } from '@shared/automations/types';
import { automationRunUpdatedChannel } from '@shared/events/automationEvents';
import { automationEvents, type AutomationHooks } from './automation-events';
import { updateRun } from './repo';

type RunHookName = Exclude<keyof AutomationHooks, 'automation:changed'>;
type RunUpdateValues = Parameters<typeof updateRun>[1];

interface EmitRunTransitionOptions {
  hook?: RunHookName | false;
  emitUpdate?: boolean;
}

function hookForStatus(status: AutomationRun['status']): RunHookName | undefined {
  switch (status) {
    case 'running':
      return 'automation:run:start';
    case 'success':
      return 'automation:run:finish';
    case 'failed':
      return 'automation:run:failed';
    case 'skipped':
      return 'automation:run:skipped';
    case 'queued':
      return undefined;
  }
}

export function emitRunUpdated(run: AutomationRun): void {
  events.emit(automationRunUpdatedChannel, {
    automationId: run.automationId,
    runId: run.id,
    status: run.status,
    taskId: run.taskId,
  });
}

export function emitRunTransition(
  run: AutomationRun,
  options: EmitRunTransitionOptions = {}
): void {
  if (options.emitUpdate !== false) emitRunUpdated(run);

  const hook = options.hook === undefined ? hookForStatus(run.status) : options.hook;
  if (hook) automationEvents._emit(hook, run);
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
  return updateRunAndEmit(runId, { taskId, createdTaskId: taskId }, { hook: false });
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
    createdTaskId?: string | null;
  }
): Promise<AutomationRun> {
  const values: RunUpdateValues = {
    status: 'failed',
    finishedAt: input.finishedAt ?? Date.now(),
    error: input.error,
  };
  if ('taskId' in input) values.taskId = input.taskId;
  if ('createdTaskId' in input) values.createdTaskId = input.createdTaskId;
  return updateRunAndEmit(runId, values, { hook: 'automation:run:failed' });
}

export async function markRunSucceeded(
  runId: string,
  input: {
    finishedAt?: number;
    taskId: string | null;
    createdTaskId: string | null;
  }
): Promise<AutomationRun> {
  return updateRunAndEmit(
    runId,
    {
      status: 'success',
      finishedAt: input.finishedAt ?? Date.now(),
      taskId: input.taskId,
      createdTaskId: input.createdTaskId,
    },
    { hook: 'automation:run:finish' }
  );
}

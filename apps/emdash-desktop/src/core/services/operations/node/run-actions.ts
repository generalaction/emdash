import { err, ok, type Result } from '@emdash/shared';
import { runWithTimeout, TimeoutError } from '@emdash/shared/scheduling';
import type { OperationRunContext, OperationRunError } from './definition';

export type OperationAction = {
  id: string;
  timeoutMs: number;
  run(signal: AbortSignal): Promise<void>;
};

export async function runOperationActions(
  context: OperationRunContext,
  actions: OperationAction[]
): Promise<Result<void, OperationRunError>> {
  let completedSteps = 0;
  context.reportProgress({ completedSteps, totalSteps: actions.length });

  for (const action of actions) {
    context.reportProgress({
      currentStep: action.id,
      completedSteps,
      totalSteps: actions.length,
    });
    try {
      await runWithTimeout((signal) => action.run(signal), {
        timeoutMs: action.timeoutMs,
        signal: context.signal,
        clock: context.clock,
      });
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : timedOut
            ? 'operation-timeout'
            : 'operation-failed';
      if (code === 'workspace-busy') {
        return err({
          type: 'awaiting-confirmation',
          reason: 'workspace-busy',
          message: workspaceBusyMessage(error),
        });
      }
      return err({
        type: 'failed',
        code,
        message: error instanceof Error ? error.message : String(error),
        retryable: !timedOut && code !== 'workspace-in-use',
      });
    }
    completedSteps += 1;
  }

  context.reportProgress({ completedSteps, totalSteps: actions.length });
  return ok(undefined);
}

function workspaceBusyMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const holders =
    typeof error === 'object' &&
    error !== null &&
    'holders' in error &&
    Array.isArray(error.holders)
      ? error.holders.filter((holder): holder is string => typeof holder === 'string')
      : [];
  if (holders.length === 0) return error.message;
  return `${error.message} Active holders: ${holders.join(', ')}`;
}

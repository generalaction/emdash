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

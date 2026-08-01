import { err, ok, type Result } from '@emdash/shared';
import type { AnyOperationDefinition, ErrorOf, InputOf, ResultOf } from '../api/definition';
import {
  isOperationRejectedError,
  OperationRejectedError,
  type HandlerContext,
  type OperationFailure,
  type OperationHandler,
} from '../api/handler';
import type { OperationStage, ProgressSink } from '../api/progress';
import {
  errorSummaryFromUnknown,
  type AbortReason,
  type OperationOutcomeSummary,
  type OperationRecord,
} from '../api/record';
import type { OperationStore } from '../api/store';

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
};

export interface ExecutionChildOperations {
  run<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>>;
  spawn<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<{ id: string }>;
}

export interface AttemptRunnerDeps<D extends AnyOperationDefinition> {
  store: OperationStore;
  record: OperationRecord;
  definition: D;
  handler: OperationHandler<D>;
  progress: ProgressSink;
  clock: Clock;
  signal: AbortSignal;
  abortReason: () => AbortReason | undefined;
  children: ExecutionChildOperations;
  shouldWaitChildren?: () => Promise<boolean>;
  onBackoff?: (recordId: string, dueAt: number) => void;
}

export async function runOperationAttempt<D extends AnyOperationDefinition>(
  deps: AttemptRunnerDeps<D>
): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>> {
  const parsed = deps.definition.input.safeParse(deps.record.input);
  if (parsed.status !== 'ok') {
    const summary = {
      message: `Stored input for '${deps.record.name}' could not be parsed: ${parsed.status}`,
      code: parsed.status,
    };
    await deps.store.transaction((tx) => {
      tx.transition(deps.record.id, deps.record.status, 'failed', 'parse-error', {
        error: summary,
        outcome: emptyOutcome(),
        updatedAt: deps.clock.now(),
      });
    });
    return err({ kind: 'failed', error: summary });
  }

  const started = await deps.store.transaction((tx) =>
    tx.transition(deps.record.id, 'pending', 'running', 'dispatch', {
      updatedAt: deps.clock.now(),
    })
  );
  if (!started) {
    return err({ kind: 'failed', error: { message: 'Operation was not pending at dispatch' } });
  }

  const stages: OperationStage[] = [];
  const facts: Record<string, unknown> = {};

  const publish = () => {
    deps.progress.publish({
      operationId: deps.record.id,
      stages: cloneStages(stages),
      updatedAt: deps.clock.now(),
    });
  };

  const ctx: HandlerContext<InputOf<D>, ErrorOf<D>> = {
    input: parsed.data,
    operationId: deps.record.id,
    attempt: deps.record.attempt,
    signal: deps.signal,
    stage: async (id, label, work) => {
      const stage: OperationStage = { id, label, status: 'running' };
      stages.push(stage);
      publish();
      try {
        const value = await work({
          signal: deps.signal,
          progress: (fraction) => {
            stage.progress = fraction;
            publish();
          },
        });
        stage.status = 'succeeded';
        stage.progress = 1;
        publish();
        return value;
      } catch (error) {
        stage.status = 'failed';
        stage.error = { message: error instanceof Error ? error.message : String(error) };
        publish();
        throw error;
      }
    },
    run: deps.children.run,
    spawn: deps.children.spawn,
    reject: (value) => {
      throw new OperationRejectedError(value);
    },
    fact: (key, value) => {
      facts[key] = value;
    },
  };

  try {
    const value = await deps.handler.run(ctx);
    const outcome = outcomeFromStages(stages, facts);
    const waitChildren = (await deps.shouldWaitChildren?.()) ?? false;
    await deps.store.transaction((tx) => {
      tx.transition(
        deps.record.id,
        'running',
        waitChildren ? 'waiting-children' : 'succeeded',
        'settle',
        {
          result: value,
          outcome,
          updatedAt: deps.clock.now(),
        }
      );
    });
    deps.progress.end(deps.record.id);
    return ok(value);
  } catch (error) {
    if (isOperationRejectedError(error)) {
      const parsedError = deps.definition.error.safeParse(error.value);
      const rejectedError = parsedError.success ? parsedError.data : error.value;
      await deps.store.transaction((tx) => {
        tx.transition(deps.record.id, 'running', 'rejected', 'settle', {
          rejectedError,
          outcome: outcomeFromStages(stages, facts),
          updatedAt: deps.clock.now(),
        });
      });
      deps.progress.end(deps.record.id);
      return err({ kind: 'rejected', error: rejectedError as ErrorOf<D> });
    }

    const abortReason = deps.abortReason();
    if (abortReason) {
      return settleAbort(deps, abortReason, stages, facts);
    }

    return settleThrownFailure(deps, error, stages, facts);
  }
}

async function settleAbort<D extends AnyOperationDefinition>(
  deps: AttemptRunnerDeps<D>,
  reason: AbortReason,
  stages: OperationStage[],
  facts: Record<string, unknown>
): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>> {
  if (reason === 'shutdown') {
    await deps.store.transaction((tx) => {
      tx.transition(deps.record.id, 'running', 'pending', 'shutdown', {
        updatedAt: deps.clock.now(),
      });
    });
    deps.progress.end(deps.record.id);
    // Shutdown is an interruption, not user cancellation. The record is reset to
    // pending; this return value is only observed by the in-process attempt.
    return err({ kind: 'cancelled' });
  }

  const terminal = reason === 'supersede' ? 'superseded' : 'cancelled';
  await deps.store.transaction((tx) => {
    tx.transition(deps.record.id, 'running', terminal, reason, {
      error: { message: `Operation aborted: ${reason}`, code: reason },
      outcome: outcomeFromStages(stages, facts),
      updatedAt: deps.clock.now(),
    });
  });
  deps.progress.end(deps.record.id);
  return err({ kind: terminal });
}

async function settleThrownFailure<D extends AnyOperationDefinition>(
  deps: AttemptRunnerDeps<D>,
  error: unknown,
  stages: OperationStage[],
  facts: Record<string, unknown>
): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>> {
  const summary = errorSummaryFromUnknown(error);
  const maxAttempts = deps.definition.retry?.maxAttempts ?? 1;
  const nextAttempt = deps.record.attempt + 1;

  if (nextAttempt < maxAttempts) {
    const notBefore = deps.clock.now() + backoffMs(deps.definition.retry, deps.record.attempt);
    await deps.store.transaction((tx) => {
      tx.transition(deps.record.id, 'running', 'pending', 'retry', {
        attempt: nextAttempt,
        notBefore,
        error: summary,
        updatedAt: deps.clock.now(),
      });
    });
    deps.onBackoff?.(deps.record.id, notBefore);
    deps.progress.end(deps.record.id);
    return err({ kind: 'failed', error: summary });
  }

  await deps.store.transaction((tx) => {
    tx.transition(deps.record.id, 'running', 'failed', 'settle', {
      error: summary,
      outcome: outcomeFromStages(stages, facts),
      updatedAt: deps.clock.now(),
    });
  });
  deps.progress.end(deps.record.id);
  return err({ kind: 'failed', error: summary });
}

function backoffMs(retry: AnyOperationDefinition['retry'], attempt: number): number {
  if (!retry) {
    return 0;
  }
  if (retry.backoff.kind === 'fixed') {
    return retry.backoff.baseMs;
  }
  const value = retry.backoff.baseMs * 2 ** attempt;
  return Math.min(value, retry.backoff.maxMs ?? value);
}

function outcomeFromStages(
  stages: readonly OperationStage[],
  facts: Record<string, unknown>
): OperationOutcomeSummary {
  return {
    version: '1',
    failedStage: stages.find((stage) => stage.status === 'failed')?.id,
    completedStages: stages
      .filter((stage) => stage.status === 'succeeded')
      .map((stage) => stage.id),
    facts: Object.keys(facts).length > 0 ? facts : undefined,
  };
}

function emptyOutcome(): OperationOutcomeSummary {
  return { version: '1', completedStages: [] };
}

function cloneStages(stages: readonly OperationStage[]): OperationStage[] {
  return stages.map((stage) => ({
    ...stage,
    substages: stage.substages ? cloneStages(stage.substages) : undefined,
  }));
}

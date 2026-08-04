import type { HandlerContext, StageContext } from '@emdash/core/primitives/kernel/api';
import {
  operationNeedsConfirmationErrorSchema,
  type OperationConfirmationReason,
} from '@emdash/core/primitives/operations/api';
import { runWithTimeout, TimeoutError, type Clock } from '@emdash/shared/scheduling';
import z from 'zod';
import type { OperationInputBase } from './definition';

export const OPERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export const operationRetryPolicy = {
  maxAttempts: 3,
  backoff: { kind: 'exponential', baseMs: 2_000 },
} as const;

export const operationResultSchema = z.object({ ok: z.literal(true) });
export type OperationResult = z.infer<typeof operationResultSchema>;

export const operationErrorSchema = z.discriminatedUnion('type', [
  operationNeedsConfirmationErrorSchema,
  z.object({
    type: z.literal('failed'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type OperationError = z.infer<typeof operationErrorSchema>;

export type OperationErrorClassifier = (error: unknown) => OperationError | undefined;

type StageFailure = Exclude<OperationStageOutcome, { kind: 'ok' }>;

export type OperationStageOutcome =
  | { kind: 'ok' }
  | { kind: 'retryable'; error: OperationStageError }
  | { kind: 'terminal'; error: OperationStageError }
  | {
      kind: 'needs-confirmation';
      reason: OperationConfirmationReason;
      message?: string;
    };

export type OperationStageError = {
  code: string;
  message: string;
};

const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const RESUME_AGE_MS = 10 * 60 * 1_000;

export function isOperationStale(input: OperationInputBase, now: number): boolean {
  return now - (input.confirmedAt ?? input.createdAt) > STALE_AFTER_MS;
}

export function isResumedOperation(
  input: OperationInputBase,
  attempt: number,
  now: number
): boolean {
  return attempt > 0 || now - input.createdAt > RESUME_AGE_MS;
}

export function stageOk(): { kind: 'ok' } {
  return { kind: 'ok' };
}

export function retryable(
  error: unknown,
  code?: string
): { kind: 'retryable'; error: OperationStageError } {
  return { kind: 'retryable', error: stageError(error, code) };
}

export function terminal(
  error: unknown,
  code?: string
): { kind: 'terminal'; error: OperationStageError } {
  return { kind: 'terminal', error: stageError(error, code) };
}

export function needsConfirmation(
  reason: OperationConfirmationReason,
  message?: string
): {
  kind: 'needs-confirmation';
  reason: OperationConfirmationReason;
  message?: string;
} {
  return { kind: 'needs-confirmation', reason, message };
}

/** The sole boundary translating typed outcomes to kernel reject/retry control flow. */
export function rejectOperationOutcome(
  ctx: Pick<HandlerContext<unknown, OperationError>, 'reject'>,
  outcome: StageFailure
): never {
  if (outcome.kind === 'needs-confirmation') {
    ctx.reject({
      type: 'needs-confirmation',
      reason: outcome.reason,
      message: outcome.message,
    });
  }
  if (outcome.kind === 'terminal') {
    ctx.reject({
      type: 'failed',
      code: outcome.error.code,
      message: outcome.error.message,
      retryable: false,
    });
  }
  throw Object.assign(new Error(outcome.error.message), {
    code: outcome.error.code,
    retryable: true,
  });
}

export async function runOperationStage(
  ctx: HandlerContext<unknown, OperationError>,
  input: {
    id: string;
    label?: string;
    timeoutMs: number;
    clock: Clock;
    classifyError?: OperationErrorClassifier;
    run(signal: AbortSignal, progress: StageContext): Promise<OperationStageOutcome>;
  }
): Promise<void> {
  await ctx.stage(input.id, input.label ?? labelFromStageId(input.id), async (stage) => {
    let outcome: OperationStageOutcome;
    try {
      outcome = await runWithTimeout((signal) => input.run(signal, stage), {
        timeoutMs: input.timeoutMs,
        signal: stage.signal,
        clock: input.clock,
      });
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      const classified = input.classifyError?.(error) ?? defaultOperationError(error, timedOut);
      outcome = outcomeFromError(classified);
    }
    if (outcome.kind !== 'ok') rejectOperationOutcome(ctx, outcome);
  });
}

function defaultOperationError(error: unknown, timedOut: boolean): OperationError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : timedOut
        ? 'operation-timeout'
        : 'operation-failed';
  return {
    type: 'failed',
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function outcomeFromError(error: OperationError): StageFailure {
  if (error.type === 'needs-confirmation') {
    return {
      kind: 'needs-confirmation',
      reason: error.reason,
      message: error.message,
    };
  }
  return error.retryable
    ? { kind: 'retryable', error: { code: error.code, message: error.message } }
    : { kind: 'terminal', error: { code: error.code, message: error.message } };
}

function stageError(error: unknown, code?: string): OperationStageError {
  const inferredCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  return {
    code: code ?? inferredCode ?? 'operation-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

function labelFromStageId(id: string): string {
  return id
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

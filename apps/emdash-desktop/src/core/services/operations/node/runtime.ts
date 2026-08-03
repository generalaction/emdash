import type { HandlerContext, StageContext } from '@emdash/core/primitives/kernel/api';
import type { OperationConfirmationReason } from '@emdash/core/primitives/operations/api';
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
  z.object({
    type: z.literal('needs-confirmation'),
    reason: z.enum(['stale', 'workspace-modified', 'reconciler-proposed', 'workspace-busy']),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('failed'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type OperationError = z.infer<typeof operationErrorSchema>;

export type OperationErrorClassifier = (error: unknown) => OperationError | undefined;

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

export function needsConfirmation(
  ctx: Pick<HandlerContext<unknown, OperationError>, 'reject'>,
  reason: OperationConfirmationReason,
  message?: string
): never {
  ctx.reject({ type: 'needs-confirmation', reason, message });
}

export function failOperation(
  ctx: Pick<HandlerContext<unknown, OperationError>, 'reject'>,
  message: string,
  options: { code?: string; retryable?: boolean } = {}
): never {
  const error = {
    type: 'failed' as const,
    code: options.code ?? 'operation-failed',
    message,
    retryable: options.retryable ?? true,
  };
  if (!error.retryable) {
    ctx.reject(error);
  }
  throw Object.assign(new Error(error.message), {
    code: error.code,
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
    run(signal: AbortSignal, progress: StageContext): Promise<void>;
  }
): Promise<void> {
  await ctx.stage(input.id, input.label ?? labelFromStageId(input.id), async (stage) => {
    try {
      await runWithTimeout((signal) => input.run(signal, stage), {
        timeoutMs: input.timeoutMs,
        signal: stage.signal,
        clock: input.clock,
      });
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      const classified = input.classifyError?.(error) ?? defaultOperationError(error, timedOut);
      if (classified.type === 'needs-confirmation') {
        ctx.reject(classified);
      }
      if (!classified.retryable) {
        ctx.reject(classified);
      }
      throw Object.assign(new Error(classified.message), {
        code: classified.code,
        retryable: true,
      });
    }
  });
}

export function confirmInput<T extends OperationInputBase>(input: T, confirmedAt: number): T {
  return { ...input, confirmedAt };
}

export function operationFailedError(
  message: string,
  options: { code?: string; retryable?: boolean } = {}
): OperationError {
  return {
    type: 'failed',
    code: options.code ?? 'operation-failed',
    message,
    retryable: options.retryable ?? true,
  };
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
    retryable: !timedOut,
  };
}

function labelFromStageId(id: string): string {
  return id
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { AnyOperationDefinition, ErrorOf, InputOf, ResultOf } from './definition';
import type { OperationProgress } from './progress';
import type { OperationErrorSummary } from './record';

export type OperationFailure<TError> =
  | { kind: 'rejected'; error: TError }
  | { kind: 'failed'; error: OperationErrorSummary }
  | { kind: 'cancelled' }
  | { kind: 'superseded' };

export interface OperationHandleLike<D extends AnyOperationDefinition> {
  id: string;
  result: Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>>;
  follow(cb: (progress: OperationProgress) => void, opts: { scope: Scope }): void;
  cancel(): Promise<void>;
}

export interface HandlerContext<TInput, TError = unknown> {
  input: TInput;
  operationId: string;
  attempt: number;
  signal: AbortSignal;
  stage<T>(id: string, label: string, work: (stage: StageContext) => Promise<T>): Promise<T>;
  run<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>>;
  spawn<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<{ id: string }>;
  reject(error: TError): never;
  fact(key: string, value: unknown): void;
}

export interface StageContext {
  progress(fraction: number): void;
  /**
   * Records a failed stage without failing the enclosing operation.
   * Use only for explicitly best-effort stages whose failure is surfaced separately.
   */
  fail(error: unknown): void;
  signal: AbortSignal;
}

export interface OperationHandler<D extends AnyOperationDefinition> {
  definition: D;
  run(ctx: HandlerContext<InputOf<D>, ErrorOf<D>>): Promise<ResultOf<D>>;
}

export function createOperationHandler<D extends AnyOperationDefinition>(
  definition: D,
  run: (ctx: HandlerContext<InputOf<D>, ErrorOf<D>>) => Promise<ResultOf<D>>
): OperationHandler<D> {
  return Object.freeze({ definition, run });
}

export class OperationRejectedError<TError = unknown> extends Error {
  constructor(readonly value: TError) {
    super('Operation rejected');
    this.name = 'OperationRejectedError';
  }
}

export function isOperationRejectedError(error: unknown): error is OperationRejectedError {
  return error instanceof OperationRejectedError;
}

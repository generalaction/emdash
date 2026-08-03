import type { VersionedSchema } from '@primitives/versioned-schema/api';
import type z from 'zod';
import type { ResourceClaim } from './resources';

export interface RetryPolicy {
  maxAttempts: number;
  backoff:
    | { kind: 'fixed'; baseMs: number }
    | { kind: 'exponential'; baseMs: number; maxMs?: number };
}

export interface OperationDefinition<TName extends string, TInput, TResult, TError> {
  readonly name: TName;
  readonly input: VersionedSchema<TInput>;
  readonly result: z.ZodType<TResult>;
  readonly error: z.ZodType<TError>;
  readonly key: (input: TInput) => string;
  readonly claims: (input: TInput) => ResourceClaim[];
  readonly describe?: (input: TInput) => string;
  readonly retry?: RetryPolicy;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyOperationDefinition = OperationDefinition<string, any, any, any>;

export type InputOf<D> =
  D extends OperationDefinition<infer _Name, infer I, infer _Result, infer _Error> ? I : never;
export type ResultOf<D> =
  D extends OperationDefinition<infer _Name, infer _Input, infer R, infer _Error> ? R : never;
export type ErrorOf<D> =
  D extends OperationDefinition<infer _Name, infer _Input, infer _Result, infer E> ? E : never;

export function defineOperation<TName extends string, TInput, TResult, TError>(spec: {
  name: TName;
  input: VersionedSchema<TInput>;
  result: z.ZodType<TResult>;
  error: z.ZodType<TError>;
  key: (input: TInput) => string;
  claims: (input: TInput) => ResourceClaim[];
  describe?: (input: TInput) => string;
  retry?: RetryPolicy;
}): OperationDefinition<TName, TInput, TResult, TError> {
  return Object.freeze({ ...spec });
}

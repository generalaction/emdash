import type { VersionedSchema } from '@primitives/versioned-schema/api';
import type z from 'zod';

export function defineResource<T extends string, TRef>(_spec: {
  name: T;
  key: (ref: TRef) => string;
  parent?: (ref: TRef) => unknown;
}) {
  return {};
}

export function defineOperation<T extends string, TInput, TResult, TError, _TState>(_spec: {
  name: T;
  input: VersionedSchema<TInput>;
  result: z.ZodType<TResult>;
  error: z.ZodType<TError>;
  key: (input: TInput) => string;
  liveModel?: unknown; // LiveModel
  claims?: (input: TInput) => unknown[];
  conflictPolicy: ConflictPolicy;
}) {
  return {};
}

type ConflictPolicyBuilder = {};

type ConflictPolicy = {};

export function defineConflictPolicy(_build: (on: ConflictPolicyBuilder) => void) {
  return {};
}

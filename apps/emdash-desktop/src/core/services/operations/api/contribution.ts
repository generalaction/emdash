import type {
  AnyOperationDefinition,
  ConflictPolicy,
  InputOf,
  OperationHandler,
} from '@emdash/core/primitives/kernel/api';

export type KernelOperationContribution<TDeps> = {
  create(dependencies: TDeps): {
    definitions: readonly AnyOperationDefinition[];
    handlers: readonly OperationHandler<AnyOperationDefinition>[];
    conflictPolicies: readonly ConflictPolicy[];
    examples: readonly OperationExample[];
  };
};

export interface OperationExample<D extends AnyOperationDefinition = AnyOperationDefinition> {
  definition: D;
  input: InputOf<D>;
}

export function defineOperationContribution<TContribution>(
  contribution: TContribution
): TContribution {
  return contribution;
}

import type { VersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import type { OperationKind } from '@core/primitives/operations/api';

export type OperationContribution<TDeps, TDefinition> = {
  kind: OperationKind;
  payload: VersionedSchema<unknown>;
  create(dependencies: TDeps): TDefinition;
};

export function defineOperationContribution<TDeps, TDefinition>(
  contribution: OperationContribution<TDeps, TDefinition>
): OperationContribution<TDeps, TDefinition> {
  return contribution;
}

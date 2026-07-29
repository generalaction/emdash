import { ok } from '@emdash/shared';
import { operationKinds, type OperationKind } from '@core/primitives/operations/api';
import type { OperationDefinition } from '../definition';

export function testOperationDefinitions(
  overrides: Partial<Record<OperationKind, OperationDefinition>> = {}
): OperationDefinition[] {
  return operationKinds.map((kind) => overrides[kind] ?? successfulOperationDefinition(kind));
}

export function successfulOperationDefinition(kind: OperationKind): OperationDefinition {
  return {
    kind,
    entityKind:
      kind === 'delete-project'
        ? 'project'
        : kind === 'delete-automation'
          ? 'automation'
          : kind === 'delete-workspace' || kind === 'archive-workspace'
            ? 'workspace'
            : 'task',
    async run() {
      return ok(undefined);
    },
    async describe() {
      return {};
    },
  };
}

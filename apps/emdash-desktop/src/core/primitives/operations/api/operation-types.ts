import {
  nonTerminalOperationStatuses,
  type OperationStatus,
} from '@emdash/core/primitives/operations/api';

export const operationKinds = ['delete-task', 'delete-automation', 'delete-project'] as const;

export type OperationKind = (typeof operationKinds)[number];

export const reconcilerDedupeStatuses = [
  ...nonTerminalOperationStatuses,
  'abandoned',
] as const satisfies readonly OperationStatus[];

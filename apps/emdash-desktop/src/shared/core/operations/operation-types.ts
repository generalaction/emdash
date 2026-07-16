export const operationKinds = [
  'delete-task',
  'delete-workspace',
  'delete-project',
  'cleanup-sessions',
] as const;

export type OperationKind = (typeof operationKinds)[number];

export const operationStatuses = [
  'pending',
  'running',
  'awaiting-confirmation',
  'succeeded',
  'failed',
  'abandoned',
] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export const nonTerminalOperationStatuses = [
  'pending',
  'running',
  'awaiting-confirmation',
  'failed',
] as const satisfies readonly OperationStatus[];

export type NonTerminalOperationStatus = (typeof nonTerminalOperationStatuses)[number];

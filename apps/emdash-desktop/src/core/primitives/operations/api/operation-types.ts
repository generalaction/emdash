export const operationKinds = [
  'delete-task',
  'delete-automation',
  'delete-workspace',
  'archive-workspace',
  'delete-project',
  'cleanup-sessions',
] as const;

export type OperationKind = (typeof operationKinds)[number];

export const operationStatuses = [
  'pending',
  'waiting-children',
  'running',
  'awaiting-confirmation',
  'succeeded',
  'failed',
  'abandoned',
] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export const nonTerminalOperationStatuses = [
  'pending',
  'waiting-children',
  'running',
  'awaiting-confirmation',
  'failed',
] as const satisfies readonly OperationStatus[];

export type NonTerminalOperationStatus = (typeof nonTerminalOperationStatuses)[number];

export const reconcilerDedupeStatuses = [
  ...nonTerminalOperationStatuses,
  'abandoned',
] as const satisfies readonly OperationStatus[];

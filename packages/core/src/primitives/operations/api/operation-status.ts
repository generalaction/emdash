import { err, ok, type Result } from '@emdash/shared';
import type { OperationConfirmationReason } from './operation-state';

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

export type OperationStatusEvent =
  | { type: 'started' }
  | { type: 'children-settled' }
  | { type: 'run-succeeded' }
  | { type: 'run-failed'; error: string; retryable: boolean }
  | { type: 'needs-confirmation'; reason: OperationConfirmationReason }
  | { type: 'user-retried'; confirmedAt: number }
  | { type: 'user-abandoned' }
  | { type: 'process-restarted' };

export type IllegalOperationTransition = {
  type: 'illegal-operation-transition';
  current: OperationStatus;
  event: OperationStatusEvent['type'];
  message: string;
};

const transitions = {
  pending: {
    started: 'running',
    'run-failed': 'failed',
    'user-retried': 'pending',
    'user-abandoned': 'abandoned',
  },
  'waiting-children': {
    'children-settled': 'pending',
    'user-abandoned': 'abandoned',
  },
  running: {
    'run-succeeded': 'succeeded',
    'run-failed': 'failed',
    'needs-confirmation': 'awaiting-confirmation',
    'process-restarted': 'pending',
  },
  'awaiting-confirmation': {
    'user-retried': 'pending',
    'user-abandoned': 'abandoned',
  },
  failed: {
    'user-retried': 'pending',
    'user-abandoned': 'abandoned',
  },
  succeeded: {},
  abandoned: {},
} as const satisfies Record<
  OperationStatus,
  Partial<Record<OperationStatusEvent['type'], OperationStatus>>
>;

export function nextOperationStatus(
  current: OperationStatus,
  event: OperationStatusEvent
): Result<OperationStatus, IllegalOperationTransition> {
  const table: Partial<Record<OperationStatusEvent['type'], OperationStatus>> =
    transitions[current];
  const next = table[event.type];
  if (!next) {
    return err({
      type: 'illegal-operation-transition',
      current,
      event: event.type,
      message: `Cannot apply operation event '${event.type}' while status is '${current}'`,
    });
  }
  return ok(next);
}

export function requireNextOperationStatus(
  current: OperationStatus,
  event: OperationStatusEvent
): OperationStatus {
  const result = nextOperationStatus(current, event);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

export const allOperationStatuses = operationStatuses;

import { describe, expect, it } from 'vitest';
import {
  nextOperationStatus,
  operationStatuses,
  type OperationStatus,
  type OperationStatusEvent,
} from './operation-status';

describe('operation status machine', () => {
  const cases: Array<{
    current: OperationStatus;
    event: OperationStatusEvent;
    next: OperationStatus;
  }> = [
    { current: 'pending', event: { type: 'started' }, next: 'running' },
    {
      current: 'waiting-children',
      event: { type: 'children-settled' },
      next: 'pending',
    },
    {
      current: 'waiting-children',
      event: { type: 'user-abandoned' },
      next: 'abandoned',
    },
    {
      current: 'pending',
      event: { type: 'run-failed', error: 'failed', retryable: false },
      next: 'failed',
    },
    {
      current: 'pending',
      event: { type: 'user-retried', confirmedAt: 1_000 },
      next: 'pending',
    },
    { current: 'pending', event: { type: 'user-abandoned' }, next: 'abandoned' },
    { current: 'running', event: { type: 'run-succeeded' }, next: 'succeeded' },
    {
      current: 'running',
      event: { type: 'run-failed', error: 'failed', retryable: false },
      next: 'failed',
    },
    {
      current: 'running',
      event: { type: 'needs-confirmation', reason: 'workspace-modified' },
      next: 'awaiting-confirmation',
    },
    { current: 'running', event: { type: 'process-restarted' }, next: 'pending' },
    {
      current: 'awaiting-confirmation',
      event: { type: 'user-retried', confirmedAt: 1_000 },
      next: 'pending',
    },
    {
      current: 'failed',
      event: { type: 'user-retried', confirmedAt: 1_000 },
      next: 'pending',
    },
    {
      current: 'awaiting-confirmation',
      event: { type: 'user-abandoned' },
      next: 'abandoned',
    },
    { current: 'failed', event: { type: 'user-abandoned' }, next: 'abandoned' },
  ];

  it.each(cases)('allows $current + $event.type -> $next', ({ current, event, next }) => {
    expect(nextOperationStatus(current, event)).toEqual({ success: true, data: next });
  });

  it('rejects every transition outside the table', () => {
    const events: OperationStatusEvent[] = [
      { type: 'started' },
      { type: 'children-settled' },
      { type: 'run-succeeded' },
      { type: 'run-failed', error: 'failed', retryable: false },
      { type: 'needs-confirmation', reason: 'workspace-modified' },
      { type: 'user-retried', confirmedAt: 1_000 },
      { type: 'user-abandoned' },
      { type: 'process-restarted' },
    ];
    const allowed = new Set(cases.map(({ current, event }) => `${current}:${event.type}`));

    for (const current of operationStatuses) {
      for (const event of events) {
        if (allowed.has(`${current}:${event.type}`)) continue;
        expect(nextOperationStatus(current, event)).toMatchObject({
          success: false,
          error: {
            type: 'illegal-operation-transition',
            current,
            event: event.type,
          },
        });
      }
    }
  });
});

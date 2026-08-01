import { describe, expect, test } from 'vitest';
import {
  activityFeed,
  displayStatus,
  operationTreeView,
  provenanceChain,
  queryRecords,
} from './query';
import type { OperationRecord } from './record';

function record(
  id: string,
  status: OperationRecord['status'],
  opts: Partial<OperationRecord> = {}
): OperationRecord {
  return {
    id,
    seq: Number(id.replace(/\D/g, '')) || 1,
    name: 'operation',
    key: `operation:${id}`,
    input: {},
    claims: [{ resource: 'resource', key: `resource:${id}`, mode: 'exclusive', implicit: false }],
    status,
    attempt: 0,
    initiator: { kind: 'user', action: 'test' },
    createdAt: 1,
    updatedAt: 1,
    ...opts,
  };
}

describe('queryRecords', () => {
  test('filters by active, resource, parent, and cursor', () => {
    const records = [
      record('op1', 'pending', {
        claims: [{ resource: 'resource', key: 'repo:a', mode: 'exclusive', implicit: false }],
      }),
      record('op2', 'succeeded', {
        claims: [
          { resource: 'resource', key: 'repo:a:worktree:b', mode: 'shared', implicit: false },
        ],
        updatedAt: 10,
        parentId: 'op1',
      }),
    ];

    expect(queryRecords(records, { active: true }).records.map((item) => item.id)).toEqual(['op1']);
    expect(
      queryRecords(records, { resource: { key: 'repo:a', subtree: true } }).records.map(
        (item) => item.id
      )
    ).toEqual(['op1', 'op2']);
    expect(queryRecords(records, { parentId: 'op1' }).records.map((item) => item.id)).toEqual([
      'op2',
    ]);
    expect(queryRecords(records, { after: { seq: 1 } }).records.map((item) => item.id)).toEqual([
      'op2',
    ]);
  });
});

describe('displayStatus', () => {
  test('derives queued and waiting states from the pass report', () => {
    const pending = record('op1', 'pending');

    expect(displayStatus(pending)).toEqual({ kind: 'queued' });
    expect(
      displayStatus(pending, {
        started: [],
        skipped: [{ id: 'op1', blockedBy: ['op0'], barredOn: [] }],
        deferred: [],
      })
    ).toEqual({ kind: 'waiting', blockedBy: ['op0'], barredOn: [] });
    expect(
      displayStatus(pending, {
        started: [],
        skipped: [],
        deferred: [{ id: 'op1', reason: 'not-before' }],
      })
    ).toEqual({ kind: 'deferred', reason: 'not-before' });
  });

  test('uses separator-aware subtree matching', () => {
    const records = [
      record('op1', 'pending', {
        claims: [{ resource: 'resource', key: 'repo:a', mode: 'exclusive', implicit: false }],
      }),
      record('op2', 'pending', {
        claims: [{ resource: 'resource', key: 'repo:ab', mode: 'exclusive', implicit: false }],
      }),
    ];

    expect(
      queryRecords(records, { resource: { key: 'repo:a', subtree: true } }).records.map(
        (item) => item.id
      )
    ).toEqual(['op1']);
  });
});

describe('folds', () => {
  test('activityFeed keeps active first and recent terminal records only', () => {
    const records = [
      record('op1', 'succeeded', { updatedAt: 1 }),
      record('op2', 'pending', { updatedAt: 2 }),
      record('op3', 'failed', { updatedAt: 90 }),
    ];

    expect(activityFeed(records, { now: 100, recentWindowMs: 20 }).map((item) => item.id)).toEqual([
      'op2',
      'op3',
    ]);
  });

  test('builds operation trees and provenance chains', () => {
    const parent = record('op1', 'succeeded', {
      initiator: { kind: 'user', action: 'delete-project' },
    });
    const child = record('op2', 'failed', {
      parentId: 'op1',
      initiator: { kind: 'operation', operationId: 'op1' },
    });
    const records = [parent, child];

    expect(operationTreeView(records)).toMatchObject([
      { record: { id: 'op1' }, children: [{ record: { id: 'op2' } }], status: { kind: 'failed' } },
    ]);
    expect(provenanceChain(child, (id) => records.find((item) => item.id === id))).toEqual([
      { kind: 'operation', operationId: 'op1' },
      { kind: 'user', action: 'delete-project' },
    ]);
  });
});

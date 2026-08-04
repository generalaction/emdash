import { describe, expect, it } from 'vitest';
import {
  decideWorkspaceActivation,
  didOperationSettleAfterWorkspaceUpdate,
} from './workspace-activation-gate';

describe('decideWorkspaceActivation', () => {
  it('activates a present workspace immediately', () => {
    expect(decideWorkspaceActivation({ observedStatus: 'present' })).toEqual({
      kind: 'activate',
    });
  });

  it('awaits a pending create operation when observation is not available yet', () => {
    expect(
      decideWorkspaceActivation({
        observedStatus: null,
        createOperation: { id: 'operation-1', status: 'pending' },
      })
    ).toEqual({ kind: 'await-operation', operationId: 'operation-1' });
  });

  it('awaits an explicit repair operation over a stale missing observation', () => {
    expect(
      decideWorkspaceActivation({
        observedStatus: 'missing',
        explicitOperation: true,
        createOperation: { id: 'operation-1', status: 'running' },
      })
    ).toEqual({ kind: 'await-operation', operationId: 'operation-1' });
  });

  it('awaits an explicit repair operation over a stale present observation', () => {
    expect(
      decideWorkspaceActivation({
        observedStatus: 'present',
        explicitOperation: true,
        createOperation: { id: 'operation-1', status: 'pending' },
      })
    ).toEqual({ kind: 'await-operation', operationId: 'operation-1' });
  });

  it('activates after an explicitly requested repair succeeds', () => {
    expect(
      decideWorkspaceActivation({
        observedStatus: 'corrupted',
        explicitOperation: true,
        createOperation: { id: 'operation-1', status: 'succeeded' },
      })
    ).toEqual({ kind: 'activate' });
  });

  it('refuses a missing observation backed only by an earlier operation', () => {
    expect(
      decideWorkspaceActivation({
        observedStatus: 'missing',
        createOperation: { id: 'operation-1', status: 'succeeded' },
      })
    ).toEqual({ kind: 'refuse', reason: 'missing' });
  });

  it('refuses a workspace observed as missing', () => {
    expect(decideWorkspaceActivation({ observedStatus: 'missing' })).toEqual({
      kind: 'refuse',
      reason: 'missing',
    });
  });

  it('refuses a failed create operation', () => {
    expect(
      decideWorkspaceActivation({
        observedStatus: null,
        createOperation: { id: 'operation-1', status: 'failed' },
      })
    ).toEqual({ kind: 'refuse', reason: 'operation-failed' });
  });

  it('uses the desktop-side workspace update as the durable repair boundary', () => {
    expect(
      didOperationSettleAfterWorkspaceUpdate(
        { updatedAt: Date.parse('2026-01-02T00:00:00.000Z') },
        '2026-01-01T00:00:00.000Z'
      )
    ).toBe(true);
    expect(
      didOperationSettleAfterWorkspaceUpdate(
        { updatedAt: Date.parse('2026-01-01T00:00:00.000Z') },
        '2026-01-02T00:00:00.000Z'
      )
    ).toBe(false);
  });
});

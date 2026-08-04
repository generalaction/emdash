import { describe, expect, it } from 'vitest';
import { decideWorkspaceActivation } from './workspace-activation-gate';

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
});

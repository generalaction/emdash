import { describe, expect, it } from 'vitest';
import { AcpDraftSyncState } from './acp-draft-sync-state';

describe('AcpDraftSyncState', () => {
  it('uses the authoritative revision when desktop opens after a mobile clear', () => {
    const state = new AcpDraftSyncState();

    expect(state.observe({ rev: 7, draft: null }, { resetRevision: true })).toEqual({
      applyText: true,
      text: '',
    });
    expect(state.expectedRevision).toBe(7);

    const editVersion = state.markLocalEdit();
    expect(state.expectedRevision).toBe(7);
    expect(state.hasPendingWrite).toBe(true);

    state.markWriteApplied(editVersion, {
      rev: 8,
      draft: { rev: 8, text: 'desktop draft', updatedAt: 100 },
    });
    expect(state.expectedRevision).toBe(8);
    expect(state.hasPendingWrite).toBe(false);
  });

  it('rebases conflicts without overwriting a pending local edit', () => {
    const state = new AcpDraftSyncState();
    expect(
      state.observe({
        rev: 1,
        draft: { rev: 1, text: 'remote draft', updatedAt: 100 },
      })
    ).toEqual({ applyText: true, text: 'remote draft' });

    state.markLocalEdit();
    expect(
      state.observe({
        rev: 2,
        draft: { rev: 2, text: 'new remote draft', updatedAt: 200 },
      })
    ).toEqual({ applyText: false, text: '' });

    state.markWriteConflict({ rev: 3, draft: null });
    expect(state.expectedRevision).toBe(3);
    expect(state.hasPendingWrite).toBe(true);
  });
});

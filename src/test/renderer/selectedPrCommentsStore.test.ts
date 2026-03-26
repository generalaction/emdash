import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrComment } from '../../renderer/lib/prCommentsStatus';

// Import the class indirectly — we need fresh instances per test,
// so we reconstruct via the module's exported singleton pattern.
// Instead, we'll test the singleton and reset it between tests via clear().
import { selectedPrCommentsStore } from '../../renderer/lib/selectedPrCommentsStore';

function makeComment(id: string, login = 'alice'): PrComment {
  return {
    id,
    author: { login },
    body: `Comment ${id}`,
    createdAt: '2026-01-01T00:00:00Z',
    type: 'comment',
  };
}

describe('selectedPrCommentsStore', () => {
  beforeEach(() => {
    selectedPrCommentsStore.clear();
  });

  it('starts empty', () => {
    expect(selectedPrCommentsStore.getSnapshot()).toEqual([]);
    expect(selectedPrCommentsStore.getSnapshot().length).toBe(0);
  });

  it('add and has', () => {
    const c = makeComment('1');
    selectedPrCommentsStore.add(c);
    expect(selectedPrCommentsStore.has('1')).toBe(true);
    expect(selectedPrCommentsStore.getSnapshot().length).toBe(1);
    expect(selectedPrCommentsStore.getSnapshot()).toEqual([c]);
  });

  it('remove', () => {
    selectedPrCommentsStore.add(makeComment('1'));
    selectedPrCommentsStore.remove('1');
    expect(selectedPrCommentsStore.has('1')).toBe(false);
    expect(selectedPrCommentsStore.getSnapshot().length).toBe(0);
  });

  it('remove non-existent id is a no-op', () => {
    const listener = vi.fn();
    selectedPrCommentsStore.subscribe(listener);
    selectedPrCommentsStore.remove('nonexistent');
    expect(listener).not.toHaveBeenCalled();
  });

  it('toggle adds then removes', () => {
    const c = makeComment('1');
    selectedPrCommentsStore.toggle(c);
    expect(selectedPrCommentsStore.has('1')).toBe(true);
    selectedPrCommentsStore.toggle(c);
    expect(selectedPrCommentsStore.has('1')).toBe(false);
  });

  it('clear removes all', () => {
    selectedPrCommentsStore.add(makeComment('1'));
    selectedPrCommentsStore.add(makeComment('2'));
    selectedPrCommentsStore.clear();
    expect(selectedPrCommentsStore.getSnapshot().length).toBe(0);
    expect(selectedPrCommentsStore.getSnapshot()).toEqual([]);
  });

  it('clear on empty store does not notify', () => {
    const listener = vi.fn();
    selectedPrCommentsStore.subscribe(listener);
    selectedPrCommentsStore.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it('getSnapshot returns stable reference until mutation', () => {
    const snap1 = selectedPrCommentsStore.getSnapshot();
    const snap2 = selectedPrCommentsStore.getSnapshot();
    expect(snap1).toBe(snap2);

    selectedPrCommentsStore.add(makeComment('1'));
    const snap3 = selectedPrCommentsStore.getSnapshot();
    expect(snap3).not.toBe(snap1);
    expect(snap3).toHaveLength(1);

    // Same reference on repeated reads
    const snap4 = selectedPrCommentsStore.getSnapshot();
    expect(snap4).toBe(snap3);
  });

  it('getSnapshot returns EMPTY sentinel when cleared', () => {
    selectedPrCommentsStore.add(makeComment('1'));
    selectedPrCommentsStore.clear();
    const snap = selectedPrCommentsStore.getSnapshot();
    expect(snap).toEqual([]);
    // Stable empty reference
    expect(snap).toBe(selectedPrCommentsStore.getSnapshot());
  });

  it('subscribe and unsubscribe', () => {
    const listener = vi.fn();
    const unsub = selectedPrCommentsStore.subscribe(listener);
    selectedPrCommentsStore.add(makeComment('1'));
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    selectedPrCommentsStore.add(makeComment('2'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

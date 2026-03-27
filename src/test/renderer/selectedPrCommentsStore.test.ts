import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrComment } from '../../renderer/lib/prCommentsStatus';

import { selectedPrCommentsStore } from '../../renderer/lib/selectedPrCommentsStore';

const TASK = 'task-1';

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
    selectedPrCommentsStore.clear(TASK);
  });

  it('starts empty', () => {
    expect(selectedPrCommentsStore.getSnapshot(TASK)).toEqual([]);
    expect(selectedPrCommentsStore.getSnapshot(TASK).length).toBe(0);
  });

  it('add and has', () => {
    const c = makeComment('1');
    selectedPrCommentsStore.add(TASK, c);
    expect(selectedPrCommentsStore.has(TASK, '1')).toBe(true);
    expect(selectedPrCommentsStore.getSnapshot(TASK).length).toBe(1);
    expect(selectedPrCommentsStore.getSnapshot(TASK)).toEqual([c]);
  });

  it('remove', () => {
    selectedPrCommentsStore.add(TASK, makeComment('1'));
    selectedPrCommentsStore.remove(TASK, '1');
    expect(selectedPrCommentsStore.has(TASK, '1')).toBe(false);
    expect(selectedPrCommentsStore.getSnapshot(TASK).length).toBe(0);
  });

  it('remove non-existent id is a no-op', () => {
    const listener = vi.fn();
    selectedPrCommentsStore.subscribe(TASK, listener);
    selectedPrCommentsStore.remove(TASK, 'nonexistent');
    expect(listener).not.toHaveBeenCalled();
  });

  it('toggle adds then removes', () => {
    const c = makeComment('1');
    selectedPrCommentsStore.toggle(TASK, c);
    expect(selectedPrCommentsStore.has(TASK, '1')).toBe(true);
    selectedPrCommentsStore.toggle(TASK, c);
    expect(selectedPrCommentsStore.has(TASK, '1')).toBe(false);
  });

  it('clear removes all', () => {
    selectedPrCommentsStore.add(TASK, makeComment('1'));
    selectedPrCommentsStore.add(TASK, makeComment('2'));
    selectedPrCommentsStore.clear(TASK);
    expect(selectedPrCommentsStore.getSnapshot(TASK).length).toBe(0);
    expect(selectedPrCommentsStore.getSnapshot(TASK)).toEqual([]);
  });

  it('clear on empty store does not notify', () => {
    const listener = vi.fn();
    selectedPrCommentsStore.subscribe(TASK, listener);
    selectedPrCommentsStore.clear(TASK);
    expect(listener).not.toHaveBeenCalled();
  });

  it('getSnapshot returns stable reference until mutation', () => {
    const snap1 = selectedPrCommentsStore.getSnapshot(TASK);
    const snap2 = selectedPrCommentsStore.getSnapshot(TASK);
    expect(snap1).toBe(snap2);

    selectedPrCommentsStore.add(TASK, makeComment('1'));
    const snap3 = selectedPrCommentsStore.getSnapshot(TASK);
    expect(snap3).not.toBe(snap1);
    expect(snap3).toHaveLength(1);

    // Same reference on repeated reads
    const snap4 = selectedPrCommentsStore.getSnapshot(TASK);
    expect(snap4).toBe(snap3);
  });

  it('getSnapshot returns EMPTY sentinel when cleared', () => {
    selectedPrCommentsStore.add(TASK, makeComment('1'));
    selectedPrCommentsStore.clear(TASK);
    const snap = selectedPrCommentsStore.getSnapshot(TASK);
    expect(snap).toEqual([]);
    // Stable empty reference
    expect(snap).toBe(selectedPrCommentsStore.getSnapshot(TASK));
  });

  it('subscribe and unsubscribe', () => {
    const listener = vi.fn();
    const unsub = selectedPrCommentsStore.subscribe(TASK, listener);
    selectedPrCommentsStore.add(TASK, makeComment('1'));
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    selectedPrCommentsStore.add(TASK, makeComment('2'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('scopes are isolated', () => {
    const other = 'task-2';
    selectedPrCommentsStore.add(TASK, makeComment('1'));
    selectedPrCommentsStore.add(other, makeComment('2'));
    expect(selectedPrCommentsStore.getSnapshot(TASK)).toHaveLength(1);
    expect(selectedPrCommentsStore.getSnapshot(other)).toHaveLength(1);
    expect(selectedPrCommentsStore.has(TASK, '2')).toBe(false);
    expect(selectedPrCommentsStore.has(other, '1')).toBe(false);

    selectedPrCommentsStore.clear(TASK);
    expect(selectedPrCommentsStore.getSnapshot(TASK)).toHaveLength(0);
    expect(selectedPrCommentsStore.getSnapshot(other)).toHaveLength(1);

    selectedPrCommentsStore.clear(other);
  });
});

import { describe, expect, it } from 'vitest';
import { ProjectViewStore } from './project-view';

describe('TaskViewStore range selection', () => {
  it('keeps the non-shift click as the range anchor', () => {
    const store = new ProjectViewStore().taskView;
    const ids = ['1', '2', '3', '4', '5'];

    store.toggleSelect('1');
    store.selectRange(ids, '5');
    store.selectRange(ids, '3');

    expect([...store.selectedIds]).toEqual(['1', '2', '3']);
    expect(store.lastSelectedId).toBe('1');
  });
});

describe('ProjectViewStore snapshots', () => {
  it('persists and restores the task sort option', () => {
    const store = new ProjectViewStore();
    store.taskView.setSortBy('pr-status');

    expect(store.snapshot.taskSortBy).toBe('pr-status');

    const restored = new ProjectViewStore();
    restored.restoreSnapshot(store.snapshot);

    expect(restored.taskView.sortBy).toBe('pr-status');
  });
});

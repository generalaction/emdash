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

describe('ProjectViewStore task view mode', () => {
  it('persists and restores the selected task view mode', () => {
    const store = new ProjectViewStore();

    store.taskView.setMode('kanban');

    expect(store.snapshot.taskViewMode).toBe('kanban');

    const restored = new ProjectViewStore();
    restored.restoreSnapshot({
      activeView: 'tasks',
      taskViewTab: 'active',
      taskViewMode: 'kanban',
    });

    expect(restored.taskView.mode).toBe('kanban');
  });
});

import { describe, expect, it } from 'vitest';
import type { ProjectViewState } from '@core/features/projects/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { ProjectViewStore } from './project-view';

describe('TaskViewStore range selection', () => {
  it('keeps the non-shift click as the range anchor', () => {
    const store = new ProjectViewStore(createHandle()).taskView;
    const ids = ['1', '2', '3', '4', '5'];

    store.toggleSelect('1');
    store.selectRange(ids, '5');
    store.selectRange(ids, '3');

    expect([...store.selectedIds]).toEqual(['1', '2', '3']);
    expect(store.lastSelectedId).toBe('1');
  });
});

describe('ProjectViewStore memento state', () => {
  it('writes project view fields through the handle', () => {
    const handle = createHandle();
    const store = new ProjectViewStore(handle);

    store.setProjectView('settings');
    store.taskView.setTab('archived');
    store.setSelectedIssueProvider('github');

    expect(handle.value).toMatchObject({
      activeView: 'settings',
      taskViewTab: 'archived',
      selectedIssueProvider: 'github',
    });
  });
});

function createHandle(): MementoHandle<ProjectViewState> {
  let value: ProjectViewState = {
    version: '1',
    activeView: 'tasks',
    taskViewTab: 'active',
  };
  return {
    get value() {
      return value;
    },
    ready: Promise.resolve(),
    isPending: false,
    hasStoredValue: true,
    read: () => value,
    update: (next) => {
      value = typeof next === 'function' ? next(value) : next;
    },
    reset: async () => {},
    flush: async () => {},
    autoPersist: () => (() => {}) as ReturnType<MementoHandle<ProjectViewState>['autoPersist']>,
    dispose: async () => {},
  };
}

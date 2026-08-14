import { observable } from 'mobx';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectViewStore } from '@core/features/projects/browser/stores/project-view';
import type { ProjectViewState } from '@core/features/projects/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { ActiveProject } from './active-project';

const state = vi.hoisted(() => ({
  view: undefined as ProjectViewStore | undefined,
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  asAvailableProject: () => ({ project: { id: 'project-1' } }),
  getProjectManagerStore: () => undefined,
  getProjectSettingsStore: () => undefined,
  getProjectStore: () => ({}),
  getProjectViewStore: () => state.view,
}));

vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useCurrentViewParams: () => ({ params: { projectId: 'project-1' } }),
}));

vi.mock('@core/features/projects/browser/components/pr-view/pr-view', () => ({
  PullRequestView: () => <div>Pull requests panel</div>,
}));

vi.mock('@core/features/projects/browser/components/settings-view/settings-panel', () => ({
  SettingsPanel: () => <div>Settings panel</div>,
}));

vi.mock('@core/features/projects/browser/components/task-view/task-list', () => ({
  TaskList: () => <div>Tasks panel</div>,
}));

vi.mock(
  '@core/features/projects/browser/components/workspaces-view/project-workspaces-view',
  () => ({
    ProjectWorkspacesView: () => <div>Workspaces panel</div>,
  })
);

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ActiveProject section state', () => {
  let host: HTMLDivElement;
  let root: Root;
  let handle: MementoHandle<ProjectViewState>;

  beforeEach(() => {
    handle = createHandle('settings');
    state.view = new ProjectViewStore(handle);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('starts from persisted selection and switches sections without changing the URL', async () => {
    const initialUrl = window.location.href;
    await act(async () => root.render(<ActiveProject />));

    const settings = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    const panel = host.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(settings?.textContent).toBe('Settings');
    expect(panel?.textContent).toBe('Settings panel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('project-section-tab-settings');
    expect(panel?.classList.contains('h-[calc(100vh-16rem)]')).toBe(false);

    const tasks = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent === 'Tasks'
    );
    await act(async () => tasks?.click());

    expect(handle.value.activeView).toBe('tasks');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toBe('Tasks panel');
    expect(
      host.querySelector('[role="tabpanel"]')?.classList.contains('h-[calc(100vh-16rem)]')
    ).toBe(true);
    expect(window.location.href).toBe(initialUrl);
  });
});

function createHandle(activeView: ProjectViewState['activeView']): MementoHandle<ProjectViewState> {
  const value = observable.box<ProjectViewState>({
    version: '1',
    activeView,
    taskViewTab: 'active',
  });
  return {
    get value() {
      return value.get();
    },
    ready: Promise.resolve(),
    isPending: false,
    hasStoredValue: true,
    read: () => value.get(),
    update: (next) => {
      value.set(typeof next === 'function' ? next(value.get()) : next);
    },
    reset: async () => {},
    flush: async () => {},
    autoPersist: () => (() => {}) as ReturnType<MementoHandle<ProjectViewState>['autoPersist']>,
    dispose: async () => {},
  };
}
